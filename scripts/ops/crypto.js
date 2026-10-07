const { createCipheriv, createDecipheriv, randomBytes, createHash } = require('node:crypto');
const { createReadStream, createWriteStream, promises: fs } = require('node:fs');
const { Transform, Readable, Writable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const magic = Buffer.from('CFBACK01');
function keyFrom(value) {
  if (!/^[a-f0-9]{64}$/i.test(value ?? ''))
    throw new Error('BACKUP_KEY_HEX must contain 32 random bytes (64 hex characters).');
  return Buffer.from(value, 'hex');
}
async function encryptStream(source, path, key) {
  const iv = randomBytes(12),
    header = Buffer.concat([magic, iv]),
    cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(header);
  let started = false;
  const envelope = new Transform({
    transform(chunk, encoding, done) {
      if (!started) {
        this.push(header);
        started = true;
      }
      done(null, chunk);
    },
    flush(done) {
      if (!started) this.push(header);
      this.push(cipher.getAuthTag());
      done();
    },
  });
  await pipeline(source, cipher, envelope, createWriteStream(path, { flags: 'wx', mode: 0o600 }));
}
async function decryptStream(path, key, destination) {
  const handle = await fs.open(path, 'r');
  let header, tag, size;
  try {
    size = (await handle.stat()).size;
    if (size < 36) throw new Error('Invalid encrypted backup');
    header = Buffer.alloc(20);
    tag = Buffer.alloc(16);
    await handle.read(header, 0, 20, 0);
    await handle.read(tag, 0, 16, size - 16);
  } finally {
    await handle.close();
  }
  if (!header.subarray(0, 8).equals(magic)) throw new Error('Unsupported backup format');
  const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(8));
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  await pipeline(
    size === 36 ? Readable.from([]) : createReadStream(path, { start: 20, end: size - 17 }),
    decipher,
    destination,
  );
}
async function readEncryptedJson(path, key) {
  const chunks = [];
  let bytes = 0;
  const sink = new Writable({
    write(chunk, encoding, done) {
      bytes += chunk.length;
      if (bytes > 20 * 1024 * 1024) return done(new Error('Manifest exceeds 20 MB'));
      chunks.push(chunk);
      done();
    },
  });
  await decryptStream(path, key, sink);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
const hashBuffer = (value) => createHash('sha256').update(value).digest('hex');
module.exports = { keyFrom, encryptStream, decryptStream, readEncryptedJson, hashBuffer };
