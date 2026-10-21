/* macOS location permission, for the 📍 button.
 *
 * Electron grants the page's geolocation request, but never asks macOS for
 * the app's own Location Services permission — on a fresh install the status
 * is "not determined", nothing prompts, and the page just gets an error until
 * the user finds the switch in System Settings by hand. (Long-standing and
 * unfixed upstream: electron/electron#45290, #46013.)
 *
 * This addon asks the way any Mac app does — CLLocationManager's
 * requestWhenInUseAuthorization — from the app's main process, so the prompt
 * names R2FEL-LOG and the answer is filed under the app's own bundle id.
 *
 * Built by scripts/build-native.js into location.node (Node-API, so the same
 * binary loads in any Electron version). Loaded by electron-main.js only.
 */
#import <CoreLocation/CoreLocation.h>
#include <node_api.h>

// Kept for the life of the app: a manager released while its prompt is up
// takes the prompt down with it.
static CLLocationManager *manager = nil;

static CLLocationManager *getManager(void) {
  if (!manager) manager = [[CLLocationManager alloc] init];
  return manager;
}

static const char *statusName(void) {
  if (![CLLocationManager locationServicesEnabled]) return "disabled";
  switch (getManager().authorizationStatus) {
    case kCLAuthorizationStatusNotDetermined: return "not-determined";
    case kCLAuthorizationStatusRestricted:    return "restricted";
    case kCLAuthorizationStatusDenied:        return "denied";
    default:                                  return "granted";   // Always / WhenInUse
  }
}

static napi_value toJs(napi_env env, const char *s) {
  napi_value v;
  napi_create_string_utf8(env, s, NAPI_AUTO_LENGTH, &v);
  return v;
}

// status() → "not-determined" | "granted" | "denied" | "restricted" | "disabled"
static napi_value Status(napi_env env, napi_callback_info info) {
  return toJs(env, statusName());
}

// request() puts up the system prompt if macOS hasn't been answered yet, and
// returns at once — the answer shows up in status() once the user clicks.
static napi_value Request(napi_env env, napi_callback_info info) {
  [getManager() requestWhenInUseAuthorization];
  return toJs(env, statusName());
}

NAPI_MODULE_INIT() {
  napi_value fn;
  napi_create_function(env, "status", NAPI_AUTO_LENGTH, Status, NULL, &fn);
  napi_set_named_property(env, exports, "status", fn);
  napi_create_function(env, "request", NAPI_AUTO_LENGTH, Request, NULL, &fn);
  napi_set_named_property(env, exports, "request", fn);
  return exports;
}
