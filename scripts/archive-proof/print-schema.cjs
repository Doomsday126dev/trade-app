#!/usr/bin/env node
'use strict';
const {schemaDocument,inspectableJson}=require('./format.cjs');
if(process.argv.length!==2){console.error('Usage: node scripts/archive-proof/print-schema.cjs');process.exitCode=2;}
else process.stdout.write(inspectableJson(schemaDocument));
