"""Rechecksum a staging catalog after optional enrichment, before publication."""
import pathlib,json,hashlib
root=pathlib.Path('dist/catalog');path=root/'manifest.json'
manifest=json.loads(path.read_text(encoding='utf-8'));raw=(root/'expanded.db').read_bytes()
manifest.update(bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest())
path.write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
