"""The canonical Host/App scientific observation, packaged with this backend."""
import json
from pero_scientific import observe

if __name__ == '__main__':
    print(json.dumps(observe(), sort_keys=True))
