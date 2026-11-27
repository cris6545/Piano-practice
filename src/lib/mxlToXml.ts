import JSZip from 'jszip'

export async function mxlToMusicXml(buffer: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer)
  const container = await zip.file('META-INF/container.xml')?.async('text')
  if (!container) {
    throw new Error('Invalid MXL: missing container.xml')
  }
  const doc = new DOMParser().parseFromString(container, 'text/xml')
  const rootPath = doc.getElementsByTagName('rootfile')[0]?.getAttribute('full-path')
  if (!rootPath) {
    throw new Error('Invalid MXL: no rootfile')
  }
  const xml = await zip.file(rootPath)?.async('text')
  if (!xml) {
    throw new Error('Invalid MXL: missing score XML')
  }
  return xml
}