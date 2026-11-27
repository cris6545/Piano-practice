// Downloads all Splendid Grand Piano .ogg samples into public/samples/piano
import { LAYERS } from 'smplr'
import { mkdir, writeFile, stat } from 'node:fs/promises'

const BASE = 'https://smpldsnds.github.io/sfzinstruments-splendid-grand-piano/samples'
const OUT = new URL('../public/samples/piano/', import.meta.url)
await mkdir(OUT, { recursive: true })

const names = [...new Set(LAYERS.flatMap((l) => l.samples.map(([, name]) => name)))]
console.log(`${names.length} samples`)

let done = 0
let failed = 0
async function get(name) {
  const file = new URL(`${encodeURIComponent(name)}.ogg`, OUT)
  try {
    if ((await stat(file)).size > 0) return done++
  } catch {}
  const url = `${BASE}/${name}.ogg`.replace(/#/g, '%23').replace(/ /g, '%20')
  const res = await fetch(url)
  if (!res.ok) {
    failed++
    return console.warn('FAILED', res.status, url)
  }
  await writeFile(file, Buffer.from(await res.arrayBuffer()))
  done++
}

for (let i = 0; i < names.length; i += 8) {
  await Promise.all(names.slice(i, i + 8).map(get))
}
console.log(`done ${done}/${names.length}, failed ${failed}`)
