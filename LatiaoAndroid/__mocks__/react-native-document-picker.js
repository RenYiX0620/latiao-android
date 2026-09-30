module.exports = {
  pick: jest.fn(async () => []),
  pickSingle: jest.fn(async () => null),
  pickDirectory: jest.fn(async () => null),
  releaseSecureAccess: jest.fn(async () => undefined),
  isCancel: jest.fn(() => false),
  isInProgress: jest.fn(() => false),
  types: { allFiles: '*/*' },
  default: {
    pick: jest.fn(async () => []),
    pickSingle: jest.fn(async () => null),
    pickDirectory: jest.fn(async () => null),
    isCancel: jest.fn(() => false),
    types: { allFiles: '*/*' },
  },
};
