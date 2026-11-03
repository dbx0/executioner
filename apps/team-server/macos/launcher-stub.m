#import <Cocoa/Cocoa.h>
#include <limits.h>
#include <signal.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>
#include <fcntl.h>
#include <mach-o/dyld.h>

/*
 * Launch Services rejects a shell script as CFBundleExecutable (kLSNoExecutableErr).
 * This stub stays alive as the Dock app, runs Resources/launcher.sh as a child, and
 * on Dock reopen (second click / open) signals the launcher to open the UI again.
 */

static char g_reopen_flag[PATH_MAX];
static pid_t g_child = 0;
static int g_child_status = 0;

static void touch_reopen_flag(void) {
  int fd = open(g_reopen_flag, O_WRONLY | O_CREAT | O_TRUNC, 0600);
  if (fd >= 0) {
    (void)write(fd, "1\n", 2);
    close(fd);
  }
}

static int resolve_paths(char *script_out, size_t script_cap) {
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

  if (snprintf(script_out, script_cap, "%s/Resources/launcher.sh", resolved) >= (int)script_cap) {
    fputs("Executioner Host: path too long\n", stderr);
    return 1;
  }
  return 0;
}

static void support_reopen_path(void) {
  const char *home = getenv("HOME");
  if (home == NULL || home[0] == '\0') {
    home = "/tmp";
  }
  snprintf(
      g_reopen_flag,
      sizeof(g_reopen_flag),
      "%s/Library/Application Support/Executioner Host/reopen.flag",
      home);
  char dir[PATH_MAX];
  snprintf(
      dir,
      sizeof(dir),
      "%s/Library/Application Support/Executioner Host",
      home);
  mkdir(dir, 0700);
}

@interface HostAppDelegate : NSObject <NSApplicationDelegate>
@end

@implementation HostAppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
  (void)notification;
  char script[PATH_MAX];
  if (resolve_paths(script, sizeof(script)) != 0) {
    [NSApp terminate:nil];
    return;
  }
  support_reopen_path();

  g_child = fork();
  if (g_child < 0) {
    perror("Executioner Host: fork");
    [NSApp terminate:nil];
    return;
  }
  if (g_child == 0) {
    execl("/bin/bash", "bash", script, (char *)NULL);
    perror("Executioner Host: exec bash");
    _exit(127);
  }

  [NSTimer scheduledTimerWithTimeInterval:0.25
                                  repeats:YES
                                    block:^(NSTimer *timer) {
                                      if (g_child <= 0) {
                                        [timer invalidate];
                                        return;
                                      }
                                      int status = 0;
                                      pid_t got = waitpid(g_child, &status, WNOHANG);
                                      if (got == g_child) {
                                        g_child_status = status;
                                        g_child = 0;
                                        [timer invalidate];
                                        [NSApp terminate:nil];
                                      }
                                    }];
}

- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)flag {
  (void)sender;
  (void)flag;
  touch_reopen_flag();
  return NO;
}

- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)sender {
  (void)sender;
  if (g_child > 0) {
    kill(g_child, SIGTERM);
    waitpid(g_child, &g_child_status, 0);
    g_child = 0;
  }
  return NSTerminateNow;
}

@end

int main(int argc, char *argv[]) {
  @autoreleasepool {
    NSApplication *app = [NSApplication sharedApplication];
    HostAppDelegate *delegate = [HostAppDelegate new];
    [app setActivationPolicy:NSApplicationActivationPolicyRegular];
    [app setDelegate:delegate];
    [app run];
  }
  if (WIFEXITED(g_child_status)) {
    return WEXITSTATUS(g_child_status);
  }
  if (WIFSIGNALED(g_child_status)) {
    return 128 + WTERMSIG(g_child_status);
  }
  return 0;
}
