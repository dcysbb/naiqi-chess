import { Capacitor, registerPlugin } from '@capacitor/core';

export const MobileHost = registerPlugin('MobileHost');

export function hasMobileHostPlugin() {
  return Capacitor.isNativePlatform?.() === true && Capacitor.getPlatform?.() === 'android';
}

export async function getMobileNetworkInfo() {
  if (!hasMobileHostPlugin()) return { addresses: [], urls: [] };
  try {
    return await MobileHost.getNetworkInfo();
  } catch (_) {
    return { addresses: [], urls: [] };
  }
}
