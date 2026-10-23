// Генератор PWA-иконок «Делим» без внешних зависимостей: PNG собирается вручную
// (zlib + CRC32), знак рисуется в дизайн-пространстве 512×512 с суперсэмплингом.
// Знак — «пополам»: кольцо с залитой левой половиной диска.
// Запуск: npm run icons
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

const BG = [5, 150, 105] // emerald-600
const FG = [255, 255, 255]

const DESIGN = 512
const CENTER = 256
const RING_INNER = 128
const RING_OUTER = 160
const CORNER_ANY = 112 // скругление для иконок «any»; маскируемые — полноквадратные

function sample(sx, sy, cornerRadius) {
  const half = DESIGN / 2
  const dx = Math.abs(sx - half) - (half - cornerRadius)
  const dy = Math.abs(sy - half) - (half - cornerRadius)
  const outside =
    Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - cornerRadius
  if (outside > 0) return null
  const d = Math.hypot(sx - CENTER, sy - CENTER)
  if (d >= RING_INNER && d <= RING_OUTER) return FG
  if (sx <= CENTER && d <= RING_INNER) return FG
  return BG
}

function renderPng(size, cornerRadius) {
  const SS = 3
  const rows = []
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4)
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let i = 0; i < SS; i++) {
        for (let j = 0; j < SS; j++) {
          const c = sample(
            (x + (i + 0.5) / SS) * (DESIGN / size),
            (y + (j + 0.5) / SS) * (DESIGN / size),
            cornerRadius,
          )
          if (c) {
            r += c[0]
            g += c[1]
            b += c[2]
            a += 255
          }
        }
      }
      const n = SS * SS
      const o = 1 + x * 4
      row[o] = Math.round(r / n)
      row[o + 1] = Math.round(g / n)
      row[o + 2] = Math.round(b / n)
      row[o + 3] = Math.round(a / n)
    }
    rows.push(row)
  }
  return encodePng(size, size, Buffer.concat(rows))
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(width, height, raw) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // разрядность
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="rgb(5 150 105)"/>
  <circle cx="256" cy="256" r="144" fill="none" stroke="#fff" stroke-width="32"/>
  <path d="M256 128 A 128 128 0 0 0 256 384 Z" fill="#fff"/>
</svg>
`

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(join(OUT_DIR, 'favicon.svg'), FAVICON_SVG)
writeFileSync(join(OUT_DIR, 'pwa-192x192.png'), renderPng(192, CORNER_ANY))
writeFileSync(join(OUT_DIR, 'pwa-512x512.png'), renderPng(512, CORNER_ANY))
writeFileSync(join(OUT_DIR, 'pwa-maskable-512.png'), renderPng(512, 0))
writeFileSync(join(OUT_DIR, 'apple-touch-icon.png'), renderPng(180, 0))
console.log('Иконки записаны в', OUT_DIR)
