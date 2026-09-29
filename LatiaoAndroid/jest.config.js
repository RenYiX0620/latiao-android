module.exports = {
  preset: 'react-native',
  moduleNameMapper: {
    '^react-native-fs$': '<rootDir>/__mocks__/react-native-fs.js',
    '^llama.rn$': '<rootDir>/__mocks__/llama-rn.js',
  },
};
