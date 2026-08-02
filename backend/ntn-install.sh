#!/usr/bin/env bash

set -euo pipefail

readonly BASE_URL="${NTN_BASE_URL:-https://ntn.dev}"
readonly INSTALL_DIR="${NTN_INSTALL_DIR:-/usr/local/bin}"
readonly REQUESTED_VERSION="${NTN_VERSION:-latest}"

if [[ "${REQUESTED_VERSION}" != "latest" && ! "${REQUESTED_VERSION}" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
	printf 'error: invalid version "%s" -- expected "latest" or a semver like "1.2.3" or "v1.2.3"\n' "${REQUESTED_VERSION}" >&2
	exit 1
fi

function info() {
	printf '==> %s\n' "$*" >&2
}

function fail() {
	printf 'error: %s\n' "$*" >&2
	exit 1
}

function require_command() {
	local command_name="$1"
	command -v "$command_name" >/dev/null 2>&1 || fail "Missing required command: ${command_name}"
}

function detect_downloader() {
	if command -v curl >/dev/null 2>&1; then
		DOWNLOADER="curl"
	elif command -v wget >/dev/null 2>&1; then
		DOWNLOADER="wget"
	else
		fail "Either curl or wget is required but neither is installed"
	fi
}

function download() {
	local url="$1"
	local output="${2:-}"

	if [[ "${DOWNLOADER}" == "curl" ]]; then
		if [[ -n "${output}" ]]; then
			curl -fsSL -o "${output}" "${url}"
		else
			curl -fsSL "${url}"
		fi
	else
		if [[ -n "${output}" ]]; then
			wget -q -O "${output}" "${url}"
		else
			wget -q -O - "${url}"
		fi
	fi
}

function detect_target() {
	local os
	local arch

	os="$(uname -s)"
	arch="$(uname -m)"

	# Detect Rosetta 2: if running as x86_64 under Rosetta on an ARM Mac,
	# use the native arm64 binary instead.
	if [[ "${os}" == "Darwin" && "${arch}" == "x86_64" ]]; then
		if [[ "$(sysctl -n sysctl.proc_translated 2>/dev/null)" == "1" ]]; then
			arch="arm64"
		fi
	fi

	case "${os}" in
	MINGW* | MSYS* | CYGWIN*)
		fail "This installer does not support Windows. Install via npm: npm install -g ntn"
		;;
	esac

	case "${os}:${arch}" in
	Darwin:arm64 | Darwin:aarch64)
		NTN_TARGET="aarch64-apple-darwin"
		NTN_PLATFORM_LABEL="darwin-arm64"
		;;
	Darwin:x86_64)
		NTN_TARGET="x86_64-apple-darwin"
		NTN_PLATFORM_LABEL="darwin-x64"
		;;
	Linux:x86_64)
		NTN_TARGET="x86_64-unknown-linux-musl"
		NTN_PLATFORM_LABEL="linux-x64"
		;;
	Linux:arm64 | Linux:aarch64)
		NTN_TARGET="aarch64-unknown-linux-musl"
		NTN_PLATFORM_LABEL="linux-arm64"
		;;
	*)
		fail "ntn does not support ${os} ${arch}"
		;;
	esac
}

function normalize_version() {
	local version="$1"
	if [[ "${version}" == v* ]]; then
		printf '%s\n' "${version}"
	else
		printf 'v%s\n' "${version}"
	fi
}

function resolve_version() {
	if [[ "${REQUESTED_VERSION}" == "latest" ]]; then
		download "${BASE_URL}/latest.txt" | tr -d '[:space:]'
	else
		normalize_version "${REQUESTED_VERSION}"
	fi
}

function verify_archive() {
	local archive_dir="$1"
	local archive_name="$2"
	local checksum_name="$3"

	if command -v shasum >/dev/null 2>&1; then
		(cd "${archive_dir}" && shasum -a 256 -c "${checksum_name}") || fail "Checksum verification failed"
		return
	fi

	if command -v sha256sum >/dev/null 2>&1; then
		(cd "${archive_dir}" && sha256sum -c "${checksum_name}") || fail "Checksum verification failed"
		return
	fi

	fail "No checksum tool found (need shasum or sha256sum)"
}

function install_binary() {
	local binary_path="$1"
	local destination_path="${INSTALL_DIR}/ntn"

	if mkdir -p "${INSTALL_DIR}" 2>/dev/null && install -m 0755 "${binary_path}" "${destination_path}" 2>/dev/null; then
		return
	fi

	cat >&2 <<EOF
error: Could not install the Notion CLI to ${destination_path}

The installer could not create or write to ${INSTALL_DIR}. This usually means the
directory is owned by another user or requires administrator permissions.

Choose a directory you can write to and re-run the installer with NTN_INSTALL_DIR:

  curl -fsSL "${BASE_URL}" | NTN_INSTALL_DIR="\$HOME/.local/bin" bash

You can also manually download the binary archive from:

  ${ARCHIVE_URL}
EOF
	exit 1
}

detect_downloader
require_command tar
require_command uname
require_command mktemp
require_command install

detect_target

VERSION="$(resolve_version)" || true
readonly VERSION
[[ -n "${VERSION}" ]] || fail "Could not resolve version (check network connectivity or NTN_BASE_URL)"
readonly ARCHIVE_NAME="ntn-${NTN_TARGET}.tar.gz"
readonly ARCHIVE_URL="${BASE_URL}/releases/${VERSION}/${ARCHIVE_NAME}"
readonly CHECKSUM_URL="${ARCHIVE_URL}.sha256"

TMP_DIR="$(mktemp -d)"
readonly TMP_DIR
trap 'rm -rf "${TMP_DIR}"' EXIT

ARCHIVE_PATH="${TMP_DIR}/${ARCHIVE_NAME}"
readonly ARCHIVE_PATH
CHECKSUM_PATH="${TMP_DIR}/${ARCHIVE_NAME}.sha256"
readonly CHECKSUM_PATH

info "Downloading ${VERSION} for ${NTN_PLATFORM_LABEL}"
if ! download "${ARCHIVE_URL}" "${ARCHIVE_PATH}"; then
	rm -f "${ARCHIVE_PATH}"
	fail "Failed to download ${ARCHIVE_URL}"
fi

if ! download "${CHECKSUM_URL}" "${CHECKSUM_PATH}"; then
	rm -f "${CHECKSUM_PATH}"
	fail "Failed to download checksum file from ${CHECKSUM_URL}"
fi

verify_archive "${TMP_DIR}" "${ARCHIVE_NAME}" "$(basename "${CHECKSUM_PATH}")"

tar -xzf "${ARCHIVE_PATH}" -C "${TMP_DIR}"

BINARY_PATH="${TMP_DIR}/ntn-${NTN_TARGET}/ntn"
readonly BINARY_PATH
[[ -f "${BINARY_PATH}" ]] || fail "Downloaded archive did not contain an ntn binary"

install_binary "${BINARY_PATH}"

cat >&2 <<'BANNER'

  ▄▄▄▄▄▄▄▄▖
 ██▄▄▄▄▄▄▄▟▙▖
 ███ ▄▄  ▄▄▐▌
 ███ ▐█▙ ▐▌▐▌
 ███ ▐▌▜▙▐▌▐▌
 ███ ▟▙ ▀█▌▐▌
  ▀█▄▄▄▄▄▄▄▞▘

BANNER

printf '  Notion CLI (Beta)\n\n' >&2
printf '  Installed ntn %s to %s/ntn\n\n' "${VERSION}" "${INSTALL_DIR}" >&2

cat >&2 <<'NEXT'
  Get started:

    ntn login              Log in to your Notion workspace
    ntn workers new        Create a new worker
    ntn datasources query  Query a data source
    ntn pages create       Create a page from Markdown
    ntn api                Call the Notion API directly
    ntn --help             See all available commands

  Add the Notion skill for your agents:

    npx skills add makenotion/skills

NEXT
