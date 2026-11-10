// -----------------------------------------------------------------------------
// The SDK handlers, registered before `connect()`. Kept apart from index.js so
// that the tests register them on the fake Gladys of the SDK.
// -----------------------------------------------------------------------------

export const ACTIONS = { test: 'test_connection' };
export const SCENE_ACTIONS = { nextDepartures: 'get_next_departures' };
export const SCENE_TRIGGERS = { delayed: 'train_delayed', cancelled: 'train_cancelled' };

export function registerHandlers(gladys, app) {
  gladys.onScanRequest(async () => {
    await app.publishDevices();
  });
  gladys.onConfigUpdated(async (config) => {
    await app.onConfigUpdated(config);
  });
  gladys.onDeviceCreated(async () => {
    await app.onDeviceChanged();
  });
  gladys.onDeviceUpdated(async () => {
    await app.onDeviceChanged();
  });
  gladys.onDeviceDeleted(async () => {
    await app.onDeviceChanged();
  });
  gladys.onAction(ACTIONS.test, () => app.testConnection());
  gladys.onSceneAction(SCENE_ACTIONS.nextDepartures, (fields) => app.nextDepartures(fields));
  gladys.on('connected', () => {
    app.onConnected().catch(() => {});
  });
  gladys.on('disconnected', () => {
    app.setLinked(false);
  });
}
