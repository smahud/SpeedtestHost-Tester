#!/usr/bin/env python3
"""Reproducible isolated official-daemon check. No root, hosts edits or license acceptance."""
import hashlib
import json
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import threading
import urllib.request
import urllib.parse
import re
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app

ROOT=Path(__file__).resolve().parents[1]
BINARY=ROOT.parent/'arena.ai/ooklaserver/x86_64/OoklaServer'
EXPECTED='f19e5ed240dc185bcaf6ca96e0fa40d5ee53e3a543f4c562082ac0d8d92f027a'

def main():
    if hashlib.sha256(BINARY.read_bytes()).hexdigest()!=EXPECTED:
        raise SystemExit('Official binary digest mismatch')
    with tempfile.TemporaryDirectory(prefix='chatgpt-ookla-') as directory:
        lab=Path(directory)
        subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(lab/'server.key'),'-out',str(lab/'server.crt'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        # Reserve a candidate ephemeral TCP port. A bind race fails the lab rather than killing any process.
        with socket.socket() as sock:
            sock.bind(('127.0.0.1',0)); port=sock.getsockname()[1]
        (lab/'OoklaServer.properties').write_text(f'''OoklaServer.tcpPorts = {port}
OoklaServer.udpPorts = {port}
OoklaServer.httpPorts = {port}
OoklaServer.useIPv4 = true
OoklaServer.useIPv6 = false
OoklaServer.addresses = 127.0.0.1
OoklaServer.allowedDomains = *
OoklaServer.enableAutoUpdate = false
OoklaServer.ssl.useLetsEncrypt = false
openSSL.server.certificateFile = {lab/'server.crt'}
openSSL.server.privateKeyFile = {lab/'server.key'}
logging.loggers.app.name = Application
logging.loggers.app.channel.class = ConsoleChannel
logging.loggers.app.level = warning
''')
        with (lab/'daemon.log').open('w') as log:
            process=subprocess.Popen([str(BINARY)],cwd=lab,stdout=log,stderr=log)
            try:
                for _ in range(100):
                    if process.poll() is not None:
                        raise RuntimeError((lab/'daemon.log').read_text()[-4000:])
                    try:
                        with socket.create_connection(('127.0.0.1',port),.1): break
                    except OSError: time.sleep(.1)
                else: raise RuntimeError('Daemon readiness timeout')
                base=[sys.executable,str(ROOT/'cli.py'),f'https://localhost:{port}','--allow-private','--legacy-port',str(port),'--json','--quiet']
                result=subprocess.run(base+['--ca-bundle',str(lab/'server.crt')],capture_output=True,text=True,timeout=180)
                if not result.stdout: raise RuntimeError(result.stderr)
                data=json.loads(result.stdout)
                data['lab']={'binary_sha256':EXPECTED,'fixture':'official OoklaServer; ephemeral loopback port; generated one-day certificate','cli_exit_code':result.returncode}
                # Remove expired transient path from the durable report.
                data['options']['ca_bundle']='generated ephemeral lab certificate'
                (ROOT/'results/official-daemon.json').write_text(json.dumps(data,indent=2)+'\n')
                print(json.dumps(data['summary']))
                web=app.make_server(0,True,port,str(lab/'server.crt'))
                thread=threading.Thread(target=web.serve_forever,daemon=True); thread.start()
                try:
                    url=f'http://127.0.0.1:{web.server_port}/host-tester'
                    form=urllib.request.urlopen(url).read().decode()
                    csrf=re.search(r'name="csrf" value="([^"]+)"',form).group(1)
                    body=urllib.parse.urlencode({'csrf':csrf,'ookla-server':f'https://localhost:{port}'}).encode()
                    page=urllib.request.urlopen(url,body,timeout=180).read().decode()
                    assert '19 passed · 0 failed' in page
                    assert page.count("class='passed'")==19
                    (ROOT/'results/web-integration.txt').write_text('GET form → POST target → shared CLI → official daemon → HTML results: 19 passed, 0 failed.\n')
                    print('Web form end-to-end: 19/19 passed')
                finally:
                    web.shutdown(); web.server_close(); thread.join()
                # Strict TLS negative control: same daemon, without trusting its certificate.
                negative=subprocess.run(base,capture_output=True,text=True,timeout=180)
                neg=json.loads(negative.stdout)
                (ROOT/'results/untrusted-tls.json').write_text(json.dumps(neg,indent=2)+'\n')
                assert result.returncode==0, data['summary']
                assert negative.returncode==1
                assert all(row['status']=='FAILED' for row in neg['sections'][0]['rows'])
                assert neg['summary']=={'passed':15,'failed':4,'total':19},neg['summary']
                print('Strict TLS negative control: 4 daemon failures, 15 legacy passes')
            finally:
                process.terminate()
                try: process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill(); process.wait()
if __name__=='__main__': main()
