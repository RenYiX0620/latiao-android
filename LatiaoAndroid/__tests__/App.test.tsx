/**
 * @format
 */

import 'react-native';
import React from 'react';
import App from '../App';

// Note: import explicitly to use the types shipped with jest.
import {it} from '@jest/globals';

// Note: test renderer must be required after react-native.
import renderer, {act} from 'react-test-renderer';

it('renders correctly', async () => {
  let tree: renderer.ReactTestRenderer;
  // 历史/偏好恢复是异步 setState，必须包在 act 里刷新
  await act(async () => {
    tree = renderer.create(<App />);
  });
  await act(async () => {
    tree.unmount();
  });
});
