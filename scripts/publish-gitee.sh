#!/usr/bin/env bash
set -euo pipefail

: "${GITEE_TOKEN:?缺少 GitHub Secret: GITEE_TOKEN}"
: "${GITEE_OWNER:?缺少 GITEE_OWNER}"
: "${GITEE_REPO:?缺少 GITEE_REPO}"
: "${RELEASE_TAG:?缺少 RELEASE_TAG}"
: "${ARTIFACT_DIR:?缺少 ARTIFACT_DIR}"

api="https://gitee.com/api/v5/repos/${GITEE_OWNER}/${GITEE_REPO}"
auth_url="https://${GITEE_OWNER}:${GITEE_TOKEN}@gitee.com/${GITEE_OWNER}/${GITEE_REPO}.git"
version="${RELEASE_TAG#v}"
manifest_url="https://gitee.com/${GITEE_OWNER}/${GITEE_REPO}/raw/updater/latest.json"

if [[ ! "$RELEASE_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "发布 Tag 必须是 v1.2.3 格式" >&2
  exit 1
fi
if ! command -v minisign >/dev/null; then
  echo "缺少 minisign，无法验证更新签名" >&2
  exit 1
fi

decode_base64_file() {
  local input="$1"
  local output="$2"
  if ! base64 --decode "$input" > "$output" 2>/dev/null; then
    base64 -D -i "$input" -o "$output"
  fi
}

decode_base64_value() {
  local value="$1"
  local output="$2"
  if ! printf '%s' "$value" | base64 --decode > "$output" 2>/dev/null; then
    printf '%s' "$value" | base64 -D > "$output"
  fi
}

public_key_encoded="$(jq -er '.plugins.updater.pubkey' src-tauri/tauri.conf.json)"
public_key_file="$(mktemp)"
decode_base64_value "$public_key_encoded" "$public_key_file"

verify_manifest() {
  local file="$1"
  local platform
  local remote_bundle
  local remote_signature
  local signature
  local url
  jq -e '
    ([
      .platforms["darwin-aarch64"].url,
      .platforms["darwin-aarch64"].signature,
      .platforms["darwin-x86_64"].url,
      .platforms["darwin-x86_64"].signature,
      .platforms["windows-x86_64"].url,
      .platforms["windows-x86_64"].signature
    ] | all(type == "string" and length > 0))
    and (.platforms["darwin-aarch64"] == .platforms["darwin-x86_64"])
  ' "$file" >/dev/null || return 1
  for platform in darwin-aarch64 windows-x86_64; do
    remote_bundle="$(mktemp)" || return 1
    remote_signature="$(mktemp)" || return 1
    url="$(jq -er --arg platform "$platform" '.platforms[$platform].url' "$file")" || return 1
    signature="$(jq -er --arg platform "$platform" '.platforms[$platform].signature' "$file")" || return 1
    curl --fail --location --silent --show-error --retry 3 --output "$remote_bundle" "$url" || return 1
    decode_base64_value "$signature" "$remote_signature" || return 1
    minisign -Vm "$remote_bundle" -x "$remote_signature" -p "$public_key_file" >/dev/null || return 1
  done
}

current_manifest="$(mktemp)"
current_status="$(curl --location --silent --show-error --output "$current_manifest" \
  --write-out '%{http_code}' "${manifest_url}?check=${RELEASE_TAG}")"
if [[ "$current_status" == "200" ]]; then
  current_version="$(jq -er '.version' "$current_manifest")"
  highest="$(printf '%s\n%s\n' "$current_version" "$version" | sort --version-sort | tail -1)"
  if [[ "$highest" != "$version" ]]; then
    echo "拒绝用 ${version} 覆盖已发布的 ${current_version}" >&2
    exit 1
  fi
  if [[ "$current_version" == "$version" ]]; then
    if verify_manifest "$current_manifest"; then
      echo "Gitee ${RELEASE_TAG} 已完整发布，跳过重复上传"
      exit 0
    fi
    echo "Gitee ${RELEASE_TAG} 已公开但校验失败；禁止原地覆盖，请创建新 Tag 修复" >&2
    exit 1
  fi
elif [[ "$current_status" != "404" ]]; then
  echo "读取 Gitee 更新清单失败，HTTP ${current_status}" >&2
  exit 1
fi

git remote add gitee "$auth_url"
git fetch --no-tags origin main
git push gitee refs/remotes/origin/main:refs/heads/main
git push gitee "refs/tags/${RELEASE_TAG}"

release_file="$(mktemp)"
status="$(curl --silent --show-error --output "$release_file" --write-out '%{http_code}' \
  --header "Authorization: Bearer ${GITEE_TOKEN}" \
  "${api}/releases/tags/${RELEASE_TAG}")"
if [[ "$status" == "404" || ( "$status" == "200" && "$(jq -r 'type' "$release_file")" == "null" ) ]]; then
  release_body="$(jq -cn \
    --arg tag "$RELEASE_TAG" \
    '{tag_name: $tag, name: ("小鱼缸 " + $tag), body: "国内安装包与自动更新文件。", target_commitish: "main", prerelease: false}')"
  curl --fail --silent --show-error --output "$release_file" \
    --request POST \
    --header "Authorization: Bearer ${GITEE_TOKEN}" \
    --header 'Content-Type: application/json' \
    --data "$release_body" \
    "${api}/releases"
elif [[ "$status" != "200" ]]; then
  echo "读取 Gitee Release 失败，HTTP ${status}" >&2
  exit 1
fi
release_id="$(jq -er '.id' "$release_file")"

attachments_file="$(mktemp)"
curl --fail --silent --show-error --output "$attachments_file" \
  --header "Authorization: Bearer ${GITEE_TOKEN}" \
  "${api}/releases/${release_id}/attach_files"

declare -a files=()
while IFS= read -r -d '' file; do
  files+=("$file")
done < <(find "$ARTIFACT_DIR" -type f \
  \( -name '*.dmg' -o -name '*.msi' -o -name '*-setup.exe' -o -name '*.app.tar.gz' -o -name '*.sig' \) \
  -print0 | sort -z)

if [[ "${#files[@]}" -eq 0 ]]; then
  echo "没有找到可发布的安装包" >&2
  exit 1
fi

mac_bundle="$(find "$ARTIFACT_DIR" -type f -name '*.app.tar.gz' | head -1)"
windows_bundle="$(find "$ARTIFACT_DIR" -type f -name '*-setup.exe' | head -1)"
if [[ -z "$mac_bundle" || ! -f "${mac_bundle}.sig" ]]; then
  echo "缺少 macOS 自动更新包或签名" >&2
  exit 1
fi
if [[ -z "$windows_bundle" || ! -f "${windows_bundle}.sig" ]]; then
  echo "缺少 Windows 自动更新包或签名" >&2
  exit 1
fi
for bundle in "$mac_bundle" "$windows_bundle"; do
  decoded_signature="$(mktemp)"
  decode_base64_file "${bundle}.sig" "$decoded_signature"
  minisign -Vm "$bundle" -x "$decoded_signature" -p "$public_key_file" >/dev/null
done

declare -A urls=()
upload_file() {
  local file="$1"
  local name
  local existing_id
  local response
  name="$(basename "$file")"
  existing_id="$(jq -r --arg name "$name" '.[] | select(.name == $name) | .id' "$attachments_file" | head -1)"
  if [[ -n "$existing_id" ]]; then
    curl --fail --silent --show-error --output /dev/null \
      --request DELETE \
      --header "Authorization: Bearer ${GITEE_TOKEN}" \
      "${api}/releases/${release_id}/attach_files/${existing_id}"
  fi
  response="$(mktemp)"
  curl --fail --silent --show-error --output "$response" \
    --request POST \
    --header "Authorization: Bearer ${GITEE_TOKEN}" \
    --form "file=@${file}" \
    "${api}/releases/${release_id}/attach_files"
  urls["$name"]="$(jq -er '.browser_download_url' "$response")"
}

for file in "${files[@]}"; do
  upload_file "$file"
done

manifest="${ARTIFACT_DIR}/latest.json"
jq -n \
  --arg version "$version" \
  --arg pub_date "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
  --arg mac_url "${urls[$(basename "$mac_bundle")]}" \
  --rawfile mac_signature "${mac_bundle}.sig" \
  --arg windows_url "${urls[$(basename "$windows_bundle")]}" \
  --rawfile windows_signature "${windows_bundle}.sig" \
  '{
    version: $version,
    notes: "小鱼缸 " + $version,
    pub_date: $pub_date,
    platforms: {
      "darwin-aarch64": { url: $mac_url, signature: ($mac_signature | rtrimstr("\n")) },
      "darwin-x86_64": { url: $mac_url, signature: ($mac_signature | rtrimstr("\n")) },
      "windows-x86_64": { url: $windows_url, signature: ($windows_signature | rtrimstr("\n")) }
    }
  }' > "$manifest"
upload_file "$manifest"

updater_dir="$(mktemp -d)"
cp "$manifest" "${updater_dir}/latest.json"
git -C "$updater_dir" init --quiet
git -C "$updater_dir" checkout --quiet -b updater
git -C "$updater_dir" config user.name github-actions
git -C "$updater_dir" config user.email github-actions@github.com
git -C "$updater_dir" add latest.json
git -C "$updater_dir" commit --quiet -m "更新 ${RELEASE_TAG} 清单"
git -C "$updater_dir" remote add origin "$auth_url"
git -C "$updater_dir" push --force origin HEAD:refs/heads/updater

published_manifest="$(mktemp)"
published=false
for _ in 1 2 3 4 5 6; do
  if curl --fail --location --silent --show-error \
    --output "$published_manifest" "${manifest_url}?released=${RELEASE_TAG}" \
    && [[ "$(jq -r '.version' "$published_manifest")" == "$version" ]]; then
    published=true
    break
  fi
  sleep 5
done
if [[ "$published" != true ]]; then
  echo "Gitee 公开更新清单未生效" >&2
  exit 1
fi
verify_manifest "$published_manifest"
