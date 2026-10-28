# Security Policy

## Reporting a vulnerability

Please report security issues in Executioner itself privately, through GitHub's [private vulnerability reporting](https://github.com/dbx0/executioner/security/advisories/new). Do not open a public issue, pull request or discussion for them.

Include what you can:

- The affected version (for example `v0.0.3`) and platform
- What an attacker can do, and what they need first (a malicious workflow, a crafted tool output, a hostile web page, local access, ...)
- Steps or a proof of concept to reproduce it

You should get a first response within 7 days. Once the issue is confirmed, a fix is released as soon as practical and you are credited in the advisory unless you ask not to be.

## Scope

In scope: the desktop app, the local engine, and how they handle untrusted input such as tool output, imported workflows, target data, agent output and web content. Examples: escaping the engine's bearer-token protection, running commands from imported data, leaking stored secrets, prompt injection that makes agents act outside their scope rules.

Out of scope: vulnerabilities in third-party tools Executioner runs (report those upstream), and findings that need an attacker who already controls your user account.

## Supported versions

Only the latest release receives security fixes. Update with the in-app notice or reinstall from the [latest release](https://github.com/dbx0/executioner/releases/latest).
