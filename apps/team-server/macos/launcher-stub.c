#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <mach-o/dyld.h>

/* Launch Services rejects a shell script as CFBundleExecutable (kLSNoExecutableErr). */
int main(void) {
  char exe[PATH_MAX];
  uint32_t size = sizeof(exe);
  if (_NSGetExecutablePath(exe, &size) != 0) {
    fputs("Executioner Host: cannot resolve executable path\n", stderr);
    return 1;
  }

  char resolved[PATH_MAX];
  if (realpath(exe, resolved) == NULL) {
    perror("Executioner Host: realpath");
    return 1;
  }

  char *macos = strstr(resolved, "/MacOS/");
  if (macos == NULL) {
    fputs("Executioner Host: unexpected bundle layout\n", stderr);
    return 1;
  }
  *macos = '\0';

  char script[PATH_MAX];
  if (snprintf(script, sizeof(script), "%s/Resources/launcher.sh", resolved) >= (int)sizeof(script)) {
    fputs("Executioner Host: path too long\n", stderr);
    return 1;
  }

  execl("/bin/bash", "bash", script, (char *)NULL);
  perror("Executioner Host: exec bash");
  return 127;
}
