/**
 * Curated install hints for the external CLI tools the node manifests invoke.
 * The Settings → Tools page probes each tool's `command.program` on PATH and,
 * when one is missing, shows the OS-specific install command from this map.
 *
 * These are hand-verified for the bundled tools. When a real package name is
 * uncertain we prefer a note + the project URL over inventing a package that
 * does not exist. Any program not in the map falls back to `genericHint`.
 */

/** OS-specific install guidance for one program. All fields optional. */
export interface InstallHint {
  /** Shell command to install on macOS (Homebrew), if known. */
  darwin?: string
  /** Shell command to install on Linux (apt/go/pipx), if known. */
  linux?: string
  /** Shell command to install on Windows, if known. */
  windows?: string
  /** A short caveat or extra step shown under the commands. */
  note?: string
  /** The tool's homepage or repository. */
  url?: string
}

/**
 * The curated map, keyed by the exact `command.program` value from the bundled
 * manifests. ProjectDiscovery tools install from brew on macOS and `go install`
 * on Linux using their real module paths (verified against each repo).
 */
const HINTS: Record<string, InstallHint> = {
  // --- Recon / DNS ---------------------------------------------------------
  amass: {
    darwin: 'brew install amass',
    linux: 'sudo apt install -y amass',
    note: 'Also available via: go install -v github.com/owasp-amass/amass/v4/...@master',
    url: 'https://github.com/owasp-amass/amass',
  },
  subfinder: {
    darwin: 'brew install subfinder',
    linux: 'go install -v github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest',
    url: 'https://github.com/projectdiscovery/subfinder',
  },
  dnsx: {
    darwin: 'brew install dnsx',
    linux: 'go install -v github.com/projectdiscovery/dnsx/cmd/dnsx@latest',
    url: 'https://github.com/projectdiscovery/dnsx',
  },
  dig: {
    darwin: 'brew install bind',
    linux: 'sudo apt install -y dnsutils',
    note: 'dig ships with the DNS utilities package (bind on macOS, dnsutils on Debian/Ubuntu).',
    url: 'https://www.isc.org/bind/',
  },
  whois: {
    darwin: 'brew install whois',
    linux: 'sudo apt install -y whois',
    url: 'https://github.com/rfc1036/whois',
  },
  theHarvester: {
    darwin: 'brew install theharvester',
    linux: 'pipx install theHarvester',
    note: 'Python tool — pipx keeps it isolated. Also available via apt on Kali (theharvester).',
    url: 'https://github.com/laramies/theHarvester',
  },
  gau: {
    darwin: 'brew install gau',
    linux: 'go install github.com/lc/gau/v2/cmd/gau@latest',
    url: 'https://github.com/lc/gau',
  },

  // --- HTTP / web fingerprinting -------------------------------------------
  httpx: {
    darwin: 'brew install httpx',
    linux: 'go install -v github.com/projectdiscovery/httpx/cmd/httpx@latest',
    note: 'ProjectDiscovery httpx — not the Python HTTP client of the same name.',
    url: 'https://github.com/projectdiscovery/httpx',
  },
  katana: {
    darwin: 'brew install katana',
    linux: 'go install github.com/projectdiscovery/katana/cmd/katana@latest',
    url: 'https://github.com/projectdiscovery/katana',
  },
  whatweb: {
    darwin: 'brew install whatweb',
    linux: 'sudo apt install -y whatweb',
    url: 'https://github.com/urbanadventurer/WhatWeb',
  },
  wafw00f: {
    darwin: 'brew install wafw00f',
    linux: 'pipx install wafw00f',
    note: 'Python tool — pipx keeps it isolated from the system interpreter.',
    url: 'https://github.com/EnableSecurity/wafw00f',
  },
  gowitness: {
    darwin: 'brew install gowitness',
    linux: 'go install github.com/sensepost/gowitness@latest',
    url: 'https://github.com/sensepost/gowitness',
  },
  nikto: {
    darwin: 'brew install nikto',
    linux: 'sudo apt install -y nikto',
    url: 'https://github.com/sullo/nikto',
  },
  wpscan: {
    darwin: 'brew install wpscan',
    linux: 'gem install wpscan',
    note: 'Ruby tool — needs a Ruby toolchain. Also available via apt on Kali.',
    url: 'https://github.com/wpscanteam/wpscan',
  },

  // --- Content discovery / fuzzing -----------------------------------------
  ffuf: {
    darwin: 'brew install ffuf',
    linux: 'go install github.com/ffuf/ffuf/v2@latest',
    url: 'https://github.com/ffuf/ffuf',
  },
  gobuster: {
    darwin: 'brew install gobuster',
    linux: 'go install github.com/OJ/gobuster/v3@latest',
    url: 'https://github.com/OJ/gobuster',
  },
  feroxbuster: {
    darwin: 'brew install feroxbuster',
    linux: 'sudo apt install -y feroxbuster',
    note: 'Also installable via: curl -sL https://raw.githubusercontent.com/epi052/feroxbuster/main/install-nix.sh | bash',
    url: 'https://github.com/epi052/feroxbuster',
  },

  // --- Port / network scanning ---------------------------------------------
  nmap: {
    darwin: 'brew install nmap',
    linux: 'sudo apt install -y nmap',
    url: 'https://nmap.org/',
  },
  masscan: {
    darwin: 'brew install masscan',
    linux: 'sudo apt install -y masscan',
    url: 'https://github.com/robertdavidgraham/masscan',
  },
  rustscan: {
    darwin: 'brew install rustscan',
    linux: 'cargo install rustscan',
    note: 'Also available as a Docker image (rustscan/rustscan) and .deb releases.',
    url: 'https://github.com/RustScan/RustScan',
  },
  naabu: {
    darwin: 'brew install naabu',
    linux: 'go install -v github.com/projectdiscovery/naabu/v2/cmd/naabu@latest',
    note: 'Needs libpcap headers for SYN scans (sudo apt install -y libpcap-dev).',
    url: 'https://github.com/projectdiscovery/naabu',
  },
  traceroute: {
    darwin: 'brew install traceroute',
    linux: 'sudo apt install -y traceroute',
    url: 'https://traceroute.sourceforge.net/',
  },
  mtr: {
    darwin: 'brew install mtr',
    linux: 'sudo apt install -y mtr-tiny',
    url: 'https://github.com/traviscross/mtr',
  },

  // --- TLS / SSL -----------------------------------------------------------
  sslscan: {
    darwin: 'brew install sslscan',
    linux: 'sudo apt install -y sslscan',
    url: 'https://github.com/rbsec/sslscan',
  },
  testssl: {
    darwin: 'brew install testssl',
    linux: 'sudo apt install -y testssl.sh',
    note: 'The binary is testssl.sh; some packages symlink it as testssl.',
    url: 'https://github.com/drwetter/testssl.sh',
  },

  // --- Vulnerability / exploitation ----------------------------------------
  nuclei: {
    darwin: 'brew install nuclei',
    linux: 'go install -v github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest',
    url: 'https://github.com/projectdiscovery/nuclei',
  },
  dalfox: {
    darwin: 'brew install dalfox',
    linux: 'go install github.com/hahwul/dalfox/v2@latest',
    url: 'https://github.com/hahwul/dalfox',
  },
  sqlmap: {
    darwin: 'brew install sqlmap',
    linux: 'sudo apt install -y sqlmap',
    note: 'Python tool — also runnable from a git clone (python sqlmap.py).',
    url: 'https://github.com/sqlmapproject/sqlmap',
  },
  searchsploit: {
    darwin: 'brew install exploitdb',
    linux: 'sudo apt install -y exploitdb',
    note: 'searchsploit ships with the exploitdb package.',
    url: 'https://gitlab.com/exploit-database/exploitdb',
  },

  // --- Auth / brute force --------------------------------------------------
  hydra: {
    darwin: 'brew install hydra',
    linux: 'sudo apt install -y hydra',
    url: 'https://github.com/vanhauser-thc/thc-hydra',
  },

  // --- Windows / AD / SMB enumeration --------------------------------------
  netexec: {
    darwin: 'pipx install git+https://github.com/Pennyw0rth/NetExec',
    linux: 'pipx install git+https://github.com/Pennyw0rth/NetExec',
    note: 'Successor to CrackMapExec; installed as nxc/netexec. Also apt on Kali (netexec).',
    url: 'https://github.com/Pennyw0rth/NetExec',
  },
  enum4linux: {
    darwin: 'brew install enum4linux',
    linux: 'sudo apt install -y enum4linux',
    url: 'https://github.com/CiscoCXSecurity/enum4linux',
  },
  nbtscan: {
    darwin: 'brew install nbtscan',
    linux: 'sudo apt install -y nbtscan',
    url: 'http://www.unixwiz.net/tools/nbtscan.html',
  },
}

/** The generic fallback for any program without a curated hint. */
export function genericHint(program: string): InstallHint {
  return { note: `Install ${program} and ensure it is on your PATH.` }
}

/**
 * Return the curated install hint for a program, or a generic fallback when the
 * program is not in the map. Never returns undefined.
 */
export function toolInstallHint(program: string): InstallHint {
  return HINTS[program] ?? genericHint(program)
}
