"""Manual authenticated Paper HTTP/PDFium journey; no Host, GUI or model claim.

python tests/e2e/paper-pdf-http.py --output test-results/paper-pdf-http/fixture.json
--live explicitly opts in to Google metadata and the selected VERID PDF only.
Original third-party bytes/page text remain temporary and are never exported.
"""
import argparse
import importlib, json, os, sys, tempfile, threading
from pathlib import Path
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT/'apps/paper-agent/backend'),str(ROOT/'tests/fixtures')]
fixture=importlib.import_module('research-pdf')
from paper_agent.store import ResearchStore
from paper_agent.http import handler

def main():
  parser=argparse.ArgumentParser(description=__doc__)
  parser.add_argument('--live',action='store_true',help='Explicitly acquire only Google VERID through Paper HTTP')
  parser.add_argument('--output',type=Path,required=True)
  options=parser.parse_args()
  seed='https://research.google/blog/grounding-ai-agents-in-biological-reality-building-blocks-for-autonomous-wet-labs/' if options.live else fixture.SEED
  selected_url='https://www.gstatic.com/science-ai/verid_semantic_lab.pdf' if options.live else fixture.URLS[0]
  receipt_summary={'scope':'Authenticated Paper Python HTTP/store/PDFium; not Host/GUI or a real LLM', 'network':'live public Google' if options.live else 'synthetic transport', 'seedUrl':seed, 'requestedPdf':selected_url, 'originalBytesExported':False}
  options.output.parent.mkdir(parents=True,exist_ok=True)
  with tempfile.TemporaryDirectory() as directory:
    os.environ['PERO_APP_DATA']=directory
    store=ResearchStore(directory)
    if not options.live: fixture.install(store)
    server=ThreadingHTTPServer(('127.0.0.1',0),handler(store,'fixture-token'))
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    def call(path,body=None):
      connection=HTTPConnection('127.0.0.1',server.server_port,timeout=10)
      connection.request('GET' if body is None else 'POST',path,None if body is None else json.dumps(body),{'Content-Type':'application/json','X-Pero-App-Token':'fixture-token'})
      response=connection.getresponse(); value=json.loads(response.read());connection.close();assert response.status<300,value;return value
    try:
      draft=call('/api/research/inspect',{'url':seed}); worker=store.imports.running.get(draft['id'])
      if worker:worker[1].join(60)
      draft=call('/api/research/inspect',{'draftId':draft['id']})
      receipt_summary['inspection']={'status':draft['status'],'warnings':draft['warnings'],'resourceCount':len(draft['resources'])}
      pdfs=[r for r in draft['resources'] if r['kind']=='pdf_candidate']
      if len(pdfs)!=3: raise RuntimeError('Expected three PDF candidates; inspection outcome: '+json.dumps(receipt_summary['inspection']))
      selection=dict(draftId=draft['id'],resourceIds=[r['id'] for r in draft['resources']])
      bundle=call('/api/research/commit',selection)
      assert bundle['pdfDownloadIds']==[]
      if not options.live: assert not any(json.loads(s)['kind']=='pdf' for s in (Path(directory)/'pdf-fixture-requests.jsonl').read_text().splitlines())
      resource=next(r for r in pdfs if r['originalUrl']==selected_url)
      bundle=call('/api/research/commit',{**selection,'pdfIds':[resource['id']],'confirmedDownloads':True})
      request=dict(bundleId=bundle['id'],resourceId=resource['id'])
      job=call('/api/research/pdf',{**request,'operation':'start'});worker=store.pdf_downloads.running.get(job['id'])
      if worker:worker[1].join(60)
      result=call('/api/research/pdf',{**request,'operation':'status'});assert result['status']=='completed',result
      receipt=result['receipt'];reading=call('/api/pdf?paperId='+receipt['paperId']);assert reading['document']['id']==receipt['documentId']
      study=call('/api/research/prepare',dict(question='Synthetic evidence verification',paperIds=[receipt['paperId']],fullText=True,requestId='pdf-http-fixture'))
      read=call('/api/studies/step',dict(studyId=study['id'],action='read',paperId=receipt['paperId'],page=1,start=0))
      passage=read['observation']['passages'][0];quote=next((line.strip() for line in passage['content'].splitlines() if 40<=len(line.strip())<=200),passage['content'].strip()[:100]);evidence=dict(paperId=receipt['paperId'],passageId=passage['id'],quote=quote)
      report=dict(schema='pero.paper-agent-report.v1',intentId=study['id'],title='Synthetic HTTP report',sections=[dict(heading='Evidence',content='Synthetic transport test only.',paperIds=[receipt['paperId']],evidence=[evidence])],experiments=[],limitations='No scientific conclusion or model call.')
      saved=call('/api/studies/step',dict(studyId=study['id'],action='finalize',report=report))
      persisted=call('/api/studies/'+study['id']);assert persisted['steps'][-1]['action']=='finalize';assert persisted['report']['intentId']==study['id']
      result=call('/api/research/pdf',{**request,'operation':'status'});assert result['readPages']==[1],result
      # Actual PDFium quotation geometry, not just matching report text.
      location=call('/api/evidence',dict(intentId=study['id'],**evidence));assert location['pdf']['fileDigest']==receipt['fileDigest'];assert location['pdf']['pages']==[1]
      receipt_summary.update(outcome='passed',receipt=receipt,studyId=study['id'],reportId=saved['reportId'],readPages=result['readPages'],pdfGeometry=bool(location['pdf']['rects']))
      print(json.dumps(receipt_summary))
    except Exception as error:
      receipt_summary.update(outcome='inconclusive' if options.live else 'failed',error=str(error))
      raise
    finally:
      options.output.write_text(json.dumps(receipt_summary,indent=2)+'\n')
      store.pdf_downloads.close();store.imports.close();server.shutdown();thread.join(3);server.server_close()
if __name__=='__main__':main()
