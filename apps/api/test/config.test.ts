import { describe, expect, it } from 'vitest';

import { loadAppConfig } from '../src/config.js';

describe('application configuration', () => {
  it('keeps outbound Feishu notifications disabled by default', () => {
    const config = loadAppConfig({});

    expect(config.feishuNotificationsEnabled).toBe(false);
    expect(config.feishuApiBaseUrl).toBe('https://open.feishu.cn');
    expect(config.reminderPollIntervalMs).toBe(15_000);
  });

  it('requires Feishu app credentials when outbound notifications are enabled', () => {
    expect(() => loadAppConfig({
      FEISHU_NOTIFICATIONS_ENABLED: 'true',
    })).toThrow('FEISHU_APP_ID');
  });
});
