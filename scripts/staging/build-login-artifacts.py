#!/usr/bin/env python3
"""Deterministic source contexts only. No container push, credentials or deployment."""
import hashlib,json,tarfile,io,sys
from pathlib import Path
root=Path(__file__).resolve().parents[2]
out=Path(sys.argv[1] if len(sys.argv)>1 else '/tmp/trade-login-staging-artifacts');out.mkdir(parents=True,exist_ok=True)
modules=['providerAuthCommitGate','providerCheckpointRecovery','discordOAuthPrototypeClient','discordCandidateRuntime','discordRegistrationView','discordCallbackPage','providerMigrationOnboarding','stagingLoginBootstrap']
files={}
for folder in ['functions/src','functions/e1-authority-service','functions/e1-gateway','functions/staging']:
 for file in (root/folder).rglob('*'):
  if not file.is_file() or 'node_modules' in file.parts or file.suffix not in ['.js','.cjs','.Dockerfile'] and file.name not in ['package.json','package-lock.json']:continue
  files[str(file.relative_to(root))]=file.read_bytes()
for name in ['index.html','bootstrap.js','discord.html']:files['staging/public/'+name]=(root/'staging/public'/name).read_bytes()
files['staging/public/config.json']=(root/'staging/public/config.template.json').read_bytes()
for name in modules:files['staging/public/modules/'+name+'.js']=(root/'js/dev'/(name+'.js')).read_bytes()
files['staging/public/modules/providerAccountFoundation.js']=(root/'js/services/providerAccountFoundation.js').read_bytes()
manifest={'kind':'source-build-context-not-container-image','productionChanged':False,'configEnabled':False,'files':{name:hashlib.sha256(data).hexdigest() for name,data in sorted(files.items())}}
for kind in ['authority','gateway']:
 target=out/(kind+'-context.tar')
 with tarfile.open(target,'w',format=tarfile.USTAR_FORMAT) as archive:
  for name,data in sorted(files.items()):
   info=tarfile.TarInfo(name);info.size=len(data);info.mtime=0;info.mode=0o644;info.uid=info.gid=0;archive.addfile(info,io.BytesIO(data))
 manifest[kind]={'file':target.name,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'dockerfile':'functions/staging/'+kind+'.Dockerfile'}
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps({kind:manifest[kind] for kind in ['authority','gateway']},indent=2))
