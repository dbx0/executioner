// electron-builder afterPack hook.
//
// macOS only: when the build has no Developer ID certificate (no CSC_LINK /
// CSC_NAME), ad-hoc sign the whole .app. electron-builder renames the Electron
// executable and rewrites Info.plist, which breaks the seal Electron ships with.
// A downloaded, quarantined bundle with a broken seal is reported by Gatekeeper
// as "damaged and can't be opened" with no override short of `xattr -cr`. An
// intact ad-hoc seal downgrades that to the regular "Apple could not verify"
// prompt, which the user can clear in System Settings > Privacy & Security >
// Open Anyway. A real signing identity re-signs over this with --force, so the
// hook is skipped whenever one is configured.
const { execFileSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  if (process.platform !== 'darwin') return
  if (process.env.CSC_LINK || process.env.CSC_NAME) return

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  console.log(`  • ad-hoc signing (no Developer ID configured)  app=${appPath}`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
}
