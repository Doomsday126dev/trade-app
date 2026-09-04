'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Require canonical paths: no symlinked ancestors, traversal, or linked files.
// This protects operator-owned directories, not a concurrent hostile OS user.
function privatePath(file, { missing = false } = {}) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || file !== path.normalize(file)) {
    throw new Error('private_path_not_canonical');
  }
  const segments = file.split(path.sep).filter(Boolean);
  let current = path.parse(file).root;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    const last = index === segments.length - 1;
    let stat;
    try { stat = fs.lstatSync(current); }
    catch (error) { if (last && missing && error.code === 'ENOENT') break; throw error; }
    if (stat.isSymbolicLink()) throw new Error('private_path_symlink');
    if (!last && !stat.isDirectory()) throw new Error('private_path_not_directory');
    if (last && (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 ||
        stat.uid !== process.getuid())) throw new Error('private_file_permissions_invalid');
  }
  const directory = fs.lstatSync(path.dirname(file));
  if (!directory.isDirectory() || (directory.mode & 0o777) !== 0o700 || directory.uid !== process.getuid()) {
    throw new Error('private_directory_permissions_invalid');
  }
  return file;
}

function readPrivate(file) {
  privatePath(file);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600 || stat.uid !== process.getuid()) {
      throw new Error('private_file_permissions_invalid');
    }
    return fs.readFileSync(fd, 'utf8');
  } finally { fs.closeSync(fd); }
}

function privateDirectory(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || directory !== path.normalize(directory)) {
    throw new Error('private_path_not_canonical');
  }
  let current = path.parse(directory).root;
  for (const segment of directory.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) fs.mkdirSync(current, { mode: 0o700 });
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('private_path_symlink');
  }
  privatePath(path.join(directory, '.private-path-probe'), { missing: true });
  return directory;
}

function atomicWrite(file, value) {
  privatePath(file, { missing: true });
  const temporary = `${file}.tmp-${crypto.randomBytes(12).toString('hex')}`;
  const fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT |
    fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  try {
    privatePath(file, { missing: true });
    fs.renameSync(temporary, file);
    const directory = fs.openSync(path.dirname(file), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

module.exports = { privatePath, privateDirectory, readPrivate, atomicWrite };
