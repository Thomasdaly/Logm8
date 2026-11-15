/** Apple Watch companion app (remote Start Work / Start Rest buttons + limit alerts). See docs/DECISIONS.md. */
/** @type {import('@bacons/apple-targets/app.plugin').Config} */
module.exports = {
  type: 'watch',
  name: 'LogM8WatchApp',
  displayName: 'LogM8',
  bundleIdentifier: '.watchkitapp',
  deploymentTarget: '10.0',
  frameworks: ['WatchConnectivity', 'UserNotifications'],
};
