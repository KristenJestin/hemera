/**
 * A self-signed certificate for `localhost`, made when a suite asks for it and trusted by nothing.
 *
 * Made at test time rather than committed: a private key in the repository is what a secret
 * scanner refuses on push, even a throwaway one. Node's `crypto` makes the key and the signature;
 * what it cannot make is the certificate around them, which is a few DER structures written here
 * (X.509 version 1: a serial, the algorithm, the issuer, the validity, the subject, the key).
 */

import { generateKeyPairSync, sign } from 'node:crypto'

/** A DER element: its tag, its length in the short or the long form, and its content. */
function der(tag: number, content: Buffer): Buffer {
  const length = content.length
  if (length < 0x80) return Buffer.concat([Buffer.of(tag, length), content])
  const bytes: number[] = []
  for (let rest = length; rest > 0; rest = Math.floor(rest / 0x100)) bytes.unshift(rest % 0x100)
  return Buffer.concat([Buffer.of(tag, 0x80 | bytes.length, ...bytes), content])
}

const sequence = (...items: Buffer[]): Buffer => der(0x30, Buffer.concat(items))

/** `ecdsa-with-SHA256`, 1.2.840.10045.4.3.2: what the certificate is signed with. */
const ECDSA_WITH_SHA256 = sequence(Buffer.from('06082a8648ce3d040302', 'hex'))

/** `CN=localhost`, as both the issuer and the subject: a certificate that vouches for itself. */
const LOCALHOST = sequence(
  der(0x31, sequence(Buffer.from('0603550403', 'hex'), der(0x0c, Buffer.from('localhost')))),
)

/** A UTCTime, `YYMMDDHHMMSSZ`, which covers every year a suite of this repository will see. */
function utcTime(at: Date): Buffer {
  return der(0x17, Buffer.from(`${at.toISOString().slice(2, 19).replace(/[-T:]/g, '')}Z`))
}

/** A pair for an https server on `localhost`, in PEM, valid from a day ago for a day. */
export function localhostCertificate() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000
  const tbs = sequence(
    der(0x02, Buffer.of(0x01)),
    ECDSA_WITH_SHA256,
    LOCALHOST,
    sequence(utcTime(new Date(now - day)), utcTime(new Date(now + day))),
    LOCALHOST,
    publicKey.export({ type: 'spki', format: 'der' }),
  )
  const signature = sign('sha256', tbs, { key: privateKey, dsaEncoding: 'der' })
  const certificate = sequence(
    tbs,
    ECDSA_WITH_SHA256,
    der(0x03, Buffer.concat([Buffer.of(0), signature])),
  )
  const lines = certificate.toString('base64').match(/.{1,64}/g) ?? []
  return {
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    cert: ['-----BEGIN CERTIFICATE-----', ...lines, '-----END CERTIFICATE-----', ''].join('\n'),
  }
}
