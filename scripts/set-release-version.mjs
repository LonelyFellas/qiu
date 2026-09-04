import fs from 'node:fs'

const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME ?? ''
if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
  throw new Error(`发布 Tag 必须是 v1.2.3 格式，实际为：${tag || '(empty)'}`)
}

const path = 'src-tauri/tauri.conf.json'
const config = JSON.parse(fs.readFileSync(path, 'utf8'))
config.version = tag.slice(1)
fs.writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`)
