/**
 * Every element the UI modules touch, looked up once when the page loads.
 */
import { $ } from '../dom.js';

export const els = Object.freeze({
  // Setup: where you live
  setup: $('#setup'),
  secPlace: $('#sec-place'),
  searchForm: $('#search-form'),
  cityInput: $('#city-input'),
  searchBtn: $('#search-form button[type="submit"]'),
  gpsBtn: $('#gps-btn'),
  quickCities: $('.quick-cities'),
  placeResults: $('#place-results'),
  placeList: $('#place-results ul'),
  placeCancel: $('#place-cancel'),
  demoStart: $('#demo-start'),
  status: $('#status'),

  // Setup: your household and day
  secYou: $('#sec-you'),
  profileForm: $('#profile-form'),
  setupPreview: $('#setup-preview'),
  youBack: $('#you-back'),
  youDone: $('#you-done'),

  // The live screen
  home: $('#home'),
  stage: $('#stage'),
  heroCopy: $('#hero-copy'),
  motionBtn: $('#motion-btn'),
  readout: $('#readout'),
  demoPanel: $('#demo-panel'),
  demoExit: $('#demo-exit'),
  simRange: $('#sim-range'),
  simOutput: $('#sim-output'),
  phasePicker: $('.phase-picker'),
  phaseOptions: $('.phase-options'),
  plan: $('#plan'),
  tabbar: $('#tabbar'),
  tabSettings: $('#tab-settings'),
  themeColour: $('meta[name="theme-color"]'),

  // Ask
  chatLog: $('#chat-log'),
  chatForm: $('#chat-form'),
  chatInput: $('#chat-input'),
  chatBtn: $('#chat-form button[type="submit"]'),
  chatError: $('#chat-error'),
  examples: $('.examples'),

  // Settings
  settings: $('#settings'),
  settingsDone: $('#settings-done'),
  setCity: $('#set-city'),
  setCityValue: $('#set-city-value'),
  setHome: $('#set-home'),
  demoToggle: $('#demo-toggle'),
  langHead: $('#lang-head'),
  langSettings: $('#lang-settings'),
  buddyPicker: $('.buddy-picker'),
  aiForm: $('#ai-form'),
  aiKey: $('#ai-key'),
  aiModel: $('#ai-model'),
  aiRemember: $('#ai-remember'),
  aiClear: $('#ai-clear'),
  aiStatus: $('#ai-status'),
});
