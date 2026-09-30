module.exports = {
  preset: 'react-native',
  moduleNameMapper: {
    '^react-native-fs$': '<rootDir>/__mocks__/react-native-fs.js',
    '^llama.rn$': '<rootDir>/__mocks__/llama-rn.js',
    '^react-native-scoped-storage$': '<rootDir>/__mocks__/react-native-scoped-storage.js',
    '^react-native-document-picker$': '<rootDir>/__mocks__/react-native-document-picker.js',
  },
};
