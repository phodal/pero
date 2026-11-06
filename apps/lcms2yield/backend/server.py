"""Host-authenticated case API. Software preparation and cluster jobs are not started here."""
import hmac
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
from urllib.parse import parse_qs, urlsplit

from lcms2yield.domain import EXAMPLE_SETS, Invalid
from lcms2yield.service import build_state, execute_custom, execute_examples, execute_rerun
from lcms2yield.catalog import load_rows


def structure_svg(smiles):
    try:
        from rdkit import Chem
        from rdkit.Chem.Draw import rdMolDraw2D
    except ImportError:
        return None
    molecule = Chem.MolFromSmiles(smiles)
    if molecule is None:
        return None
    drawer = rdMolDraw2D.MolDraw2DSVG(280, 180)
    drawer.DrawMolecule(molecule)
    drawer.FinishDrawing()
    svg = drawer.GetDrawingText()
    if '<svg' not in svg:
        return None
    return svg


def handler(secret):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def reply(self, status, value):
            body = json.dumps(value, ensure_ascii=False).encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def body(self, limit):
            if self.headers.get('Transfer-Encoding') or not self.headers.get('Content-Type', '').startswith('application/json'):
                raise ValueError('A JSON request with Content-Length is required')
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= limit:
                raise ValueError('Request exceeds its size limit')
            content = self.rfile.read(length)
            if len(content) != length:
                raise ValueError('Incomplete request')
            return json.loads(content)

        def dispatch(self):
            if not secret or not hmac.compare_digest(secret, self.headers.get('X-Pero-App-Token', '')):
                return self.reply(401, {'detail': 'Host authentication required'})
            try:
                parsed = urlsplit(self.path)
                if self.command == 'GET' and parsed.path == '/api/state':
                    return self.reply(200, build_state())
                if self.command == 'GET' and parsed.path == '/api/structure':
                    query = parse_qs(parsed.query)
                    example = query.get('example', [''])[0]
                    if example:
                        match = next((item for items in EXAMPLE_SETS.values() for item in items if item[0] == example), None)
                        if match is None:
                            raise ValueError('Choose an official example')
                        svg = structure_svg(match[1])
                        return self.reply(200, {'example': example, 'smiles': match[1], 'svg': svg, 'available': svg is not None})
                    index = query.get('index', [''])[0]
                    if not index.isdigit():
                        raise ValueError('Choose a reaction row')
                    rows = load_rows()
                    position = int(index)
                    if position >= len(rows):
                        raise ValueError('Choose a reaction row')
                    smiles = rows[position].product_smiles
                    svg = structure_svg(smiles)
                    return self.reply(200, {'index': position, 'smiles': smiles, 'svg': svg, 'available': svg is not None})
                if self.command != 'POST' or parsed.path not in ('/api/rerun', '/api/examples', '/api/predict'):
                    return self.reply(404, {'detail': 'Route not found'})
                value = self.body(32768 if parsed.path == '/api/predict' else 256)
                if value.get('confirm') is not True:
                    raise ValueError('Confirm this weight run before it starts')
                kind = value.get('set', 'readme')
                if parsed.path == '/api/predict':
                    execute_custom(value.get('smiles'))
                elif parsed.path == '/api/examples':
                    execute_examples(kind if isinstance(kind, str) else 'readme')
                else:
                    execute_rerun(load_rows())
                return self.reply(200, build_state())
            except Invalid as error:
                return self.reply(409, {'detail': error.detail, 'code': error.code, 'paper': 'INCONCLUSIVE'})
            except FileNotFoundError as error:
                return self.reply(409, {'detail': str(error), 'code': 'checkout', 'paper': 'INCONCLUSIVE'})
            except (ValueError, TypeError, json.JSONDecodeError) as error:
                return self.reply(400, {'detail': str(error)})
            except OSError:
                return self.reply(500, {'detail': 'Could not save the case record'})

        do_GET = dispatch
        do_POST = dispatch
    return Handler


if __name__ == '__main__':
    server = HTTPServer(('127.0.0.1', 0), handler(os.environ['PERO_APP_TOKEN']))
    print(json.dumps({'port': server.server_port}), flush=True)
    server.serve_forever()
