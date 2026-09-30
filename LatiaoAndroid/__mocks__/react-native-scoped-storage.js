module.exports = {
  openDocumentTree: jest.fn(async () => null),
  listFiles: jest.fn(async () => []),
  openDocument: jest.fn(async () => null),
  deleteFile: jest.fn(async () => true),
  rename: jest.fn(async () => ''),
  createDirectory: jest.fn(async () => null),
  getPersistedUriPermissions: jest.fn(async () => []),
  releasePersistableUriPermission: jest.fn(async () => undefined),
  default: {},
};
