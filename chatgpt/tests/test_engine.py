import base64
import hashlib
import http.client
import io
import json
from pathlib import Path
import socket
import struct
import sys
import threading
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import engine
import app


class BytesSocket:
    def __init__(self, data):
        self.data = io.BytesIO(data)
    def recv(self, n):
        return self.data.read(n)


class EngineTests(unittest.TestCase):
    def test_normalization(self):
        for raw, expected in [('example.com', 'example.com:8080'), ('https://example.com:443/', 'example.com:443'), ('[::1]:8080', '[::1]:8080')]:
            self.assertEqual(engine.normalize_target(raw)[0], expected)
        for raw in ['ftp://example.com', 'https://user:pass@example.com', 'example.com:0', 'example.com:65536', 'foo\r\nbar', '']:
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                engine.normalize_target(raw)

    def test_mixed_dns_never_falls_back_to_private(self):
        addresses = [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('127.0.0.1',8080)), (socket.AF_INET, socket.SOCK_STREAM, 6, '', ('1.1.1.1',8080))]
        with patch('engine.socket.getaddrinfo', return_value=addresses):
            self.assertEqual([a['ip'] for a in engine.resolve_host('example.com',8080)], ['1.1.1.1'])
            self.assertEqual(len(engine.resolve_host('example.com',8080,True)),2)
        with patch('engine.socket.getaddrinfo', return_value=addresses[:1]):
            with self.assertRaises(ValueError):
                engine.resolve_host('example.com',8080)

    def test_bounded_stream_retains_only_prefix(self):
        data, size = engine.read_body(io.BytesIO(b'x'*100000),100000)
        self.assertEqual(size,100000)
        self.assertEqual(len(data),4096)
        with self.assertRaises(ValueError):
            engine.read_body(io.BytesIO(b'x'*100001),100000)

    def test_ws_rejects_giant_masked_and_invalid_control_frames(self):
        for data in [b'\x81\x7f'+struct.pack('>Q',2**40), b'\x81\x80', b'\x09\x00']:
            with self.subTest(data=data), self.assertRaises(ValueError):
                engine.ws_recv_frame(BytesSocket(data))

    def test_hello_requires_whole_message(self):
        self.assertTrue(engine.parse_hello('HELLO 2.11 (2.11.5) build'))
        self.assertIsNone(engine.parse_hello('garbage HELLO 2.11 (2.11.5) build'))

    def test_policy_port_belongs_to_same_rule(self):
        body=b'<cross-domain-policy><allow-access-from domain="*" to-ports="80"/><allow-access-from domain="other" to-ports="8080"/></cross-domain-policy>'
        with patch('engine.raw_http', return_value={'status':200, 'body':body}):
            self.assertEqual(engine.crossdomain_check('host',8080,[],['*.ookla.com'])['status'],'FAILED')
        body=b'<cross-domain-policy><!-- <allow-access-from domain="*"/> --></cross-domain-policy>'
        with patch('engine.raw_http', return_value={'status':200, 'body':body}):
            self.assertEqual(engine.crossdomain_check('host',8080,[],['*.ookla.com'])['status'],'FAILED')

    def test_keepalive_404_is_not_success(self):
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        class Handler(BaseHTTPRequestHandler):
            protocol_version='HTTP/1.1'
            def do_GET(self):
                self.send_response(404)
                self.send_header('Content-Length','9')
                self.end_headers()
                self.wfile.write(b'test=test')
            def log_message(self,*args): pass
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        t=threading.Thread(target=server.serve_forever,daemon=True); t.start()
        try:
            port=server.server_port
            self.assertEqual(engine.keepalive_check('localhost',engine.resolve_host('127.0.0.1',port,True),port)['status'],'FAILED')
        finally:
            server.shutdown(); server.server_close(); t.join()

    def test_websocket_coalescing_fragmentation_and_ping(self):
        left,right=socket.socketpair()
        errors=[]
        def server():
            try:
                head=b''
                while not head.endswith(b'\r\n\r\n'): head+=right.recv(1)
                key=[x.split(b': ',1)[1] for x in head.split(b'\r\n') if x.startswith(b'Sec-WebSocket-Key:')][0]
                accept=base64.b64encode(hashlib.sha1(key+b'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest())
                # A ping immediately follows the handshake, then fragmented text.
                right.sendall(b'HTTP/1.1 101 Anything\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+b'\r\n\r\n'+b'\x89\x01x'+b'\x01\x06HELLO '+b'\x80\x15' + b'2.11 (2.11.5) build12x')
                right.settimeout(2)
                right.recv(4096)
            except Exception as exc: errors.append(str(exc))
            finally: right.close()
        thread=threading.Thread(target=server); thread.start()
        with patch('engine.connect_first',return_value=(left,'local')):
            result=engine.websocket_check('localhost',8080,[])
        thread.join()
        self.assertEqual(errors,[])
        self.assertEqual(result['status'],'PASSED',result)


class WebTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server=app.make_server(0)
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True); cls.thread.start()
    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.server.server_close(); cls.thread.join()
    def request(self,method,path,body=None,headers=None):
        conn=http.client.HTTPConnection('127.0.0.1',self.server.server_port)
        conn.request(method,path,body,headers or {})
        response=conn.getresponse(); data=response.read(); status=response.status
        conn.close(); return status,data
    def test_form_and_health(self):
        status,body=self.request('GET','/host-tester')
        self.assertEqual(status,200); self.assertIn(b'name="ookla-server"',body)
        self.assertNotIn(b'__CSRF__',body)
        self.assertEqual(self.request('GET','/health')[0],200)
    def test_host_rebinding_rejected(self):
        self.assertEqual(self.request('GET','/',headers={'Host':'evil.example'})[0],403)
    def test_missing_csrf_does_not_execute(self):
        self.assertEqual(self.request('POST','/host-tester','ookla-server=localhost',{'Content-Type':'application/x-www-form-urlencoded'})[0],403)
    def test_get_api_cannot_trigger_probe(self):
        self.assertEqual(self.request('GET','/api/test?host=localhost')[0],404)
    def test_oversize_request(self):
        self.assertEqual(self.request('POST','/host-tester','x'*4097,{'Content-Type':'application/x-www-form-urlencoded'})[0],413)
    def test_untrusted_results_escaped(self):
        data={'summary':{'passed':0,'failed':1},'normalized_input':'<script>','timestamp':'now','sections':[{'title':'<script>','rows':[{'key':'x','status':'FAILED','details':'<img src=x onerror=evil>'}]}]}
        rendered=app.results(data)
        self.assertNotIn('<script>',rendered); self.assertNotIn('<img',rendered)

class CliTests(unittest.TestCase):
    def test_invalid_input_exit_two(self):
        import subprocess
        result=subprocess.run([sys.executable,str(Path(app.ROOT)/'cli.py'),'ftp://example.com','--json'],capture_output=True,text=True)
        self.assertEqual(result.returncode,2)
        self.assertEqual(result.stdout,'')
        self.assertIn('Only HTTP and HTTPS',result.stderr)

    def test_refused_port_produces_nineteen_failures(self):
        # Reserve, but do not listen: avoids choosing an unrelated live service.
        with socket.socket() as reserved:
            reserved.bind(('127.0.0.1',0))
            port=reserved.getsockname()[1]
            data=engine.run_all_tests(f'127.0.0.1:{port}',allow_private=True,legacy_port=port)
        self.assertEqual(data['summary'],{'passed':0,'failed':19,'total':19})

if __name__=='__main__': unittest.main()
