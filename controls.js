(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MayhemControls = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const RESERVED = new Set(['Escape', 'Tab', 'KeyP', 'KeyM', 'KeyI', 'KeyG']);
  const canonical = code => ({ ShiftRight: 'ShiftLeft', ControlRight: 'ControlLeft' })[code] || code;
  const validKey = code => typeof code === 'string' && !RESERVED.has(code) && /^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|Space|ShiftLeft|ControlLeft|Enter|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Backquote|Numpad[0-9])$/.test(code);
  const keyLabel = code => ({ Space: 'Space', ShiftLeft: 'Shift', ControlLeft: 'Ctrl', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`' })[code] || code.replace(/^Key|^Digit/, '').replace('Numpad', 'Num ');
  const action = (id, label, ...keys) => ({ id, label, keys });
  const common = () => [action('interact', 'Enter / exit / interact', 'KeyE'), action('recover', 'Recover vehicle', 'KeyR'), action('recenter', 'Recenter camera', 'KeyC')];
  const radio = () => [action('radioPrevious', 'Previous radio station', 'KeyB'), action('radioNext', 'Next radio station', 'KeyN')];
  const movement = (forward, backward, left = 'Steer left', right = 'Steer right') => [action('up', forward, 'KeyW', 'ArrowUp'), action('down', backward, 'KeyS', 'ArrowDown'), action('left', left, 'KeyA', 'ArrowLeft'), action('right', right, 'KeyD', 'ArrowRight')];
  const ground = () => [...movement('Accelerate', 'Brake / reverse'), action('brake', 'Handbrake / drift', 'Space'), action('boost', 'Boost', 'ShiftLeft'), action('horn', 'Horn', 'KeyH'), ...common(), ...radio()];
  const GROUPS = {
    foot: { name: 'On foot', actions: [...movement('Walk forward', 'Walk backward', 'Walk left', 'Walk right'), action('jump', 'Jump', 'Space'), action('boost', 'Sprint', 'ShiftLeft'), action('flop', 'Dramatic tumble', 'KeyF'), ...common()] },
    car: { name: 'Cars & trucks', actions: ground() },
    tank: { name: 'Tanks', actions: ground().map(item => item.id === 'brake' ? { ...item, label: 'Brake' } : item) },
    helicopter: { name: 'Helicopters', actions: [...movement('Forward', 'Backward', 'Turn left', 'Turn right'), action('climb', 'Climb', 'Space'), action('descend', 'Descend', 'ControlLeft'), action('hover', 'Hover assist', 'ShiftLeft'), action('bail', 'Parachute bailout', 'KeyF'), ...common(), ...radio()] },
    plane: { name: 'Planes', actions: [action('pitchDown', 'Pitch nose down', 'KeyW', 'ArrowUp'), action('pitchUp', 'Pitch nose up', 'KeyS', 'ArrowDown'), action('rollLeft', 'Roll / bank left', 'KeyA', 'ArrowLeft'), action('rollRight', 'Roll / bank right', 'KeyD', 'ArrowRight'), action('yawLeft', 'Yaw / rudder left', 'KeyQ'), action('yawRight', 'Yaw / rudder right', 'KeyE'), action('throttleUp', 'Increase throttle', 'ShiftLeft'), action('throttleDown', 'Decrease throttle', 'Space'), action('bail', 'Parachute bailout', 'KeyF'), ...common().map(item => item.id === 'interact' ? { ...item, keys: ['KeyX'] } : item), ...radio()] }
  };
  const legacyPlane = [...movement('Increase throttle', 'Decrease throttle', 'Bank / turn left', 'Bank / turn right'), action('climb', 'Pitch / climb', 'Space'), action('descend', 'Pitch / descend', 'ControlLeft'), action('boost', 'Boost', 'ShiftLeft'), action('bail', 'Parachute bailout', 'KeyF'), ...common(), ...radio()];
  const presets = group => group === 'plane' ? [{ id: 'standard', name: 'Flight axes (recommended)' }, { id: 'arrows', name: 'Arrow flight axes' }, { id: 'legacy', name: 'Classic arcade' }] : [{ id: 'standard', name: 'WASD + arrows' }, { id: 'arrows', name: 'Arrow keys' }];
  const actions = (group, preset) => group === 'plane' && preset === 'legacy' ? legacyPlane : GROUPS[group].actions;
  function defaults(group, preset = 'standard') {
    return Object.fromEntries(actions(group, preset).map(item => [item.id, preset === 'arrows' && item.keys.some(key => key.startsWith('Arrow')) ? item.keys.filter(key => key.startsWith('Arrow')) : [...item.keys]]));
  }
  function normalizeSettings(value) {
    const result = {};
    for (const group of Object.keys(GROUPS)) {
      const saved = value?.[group];
      const preset = presets(group).some(item => item.id === saved?.preset) ? saved.preset : 'standard';
      result[group] = { preset, bindings: defaults(group, preset) };
      // Validate the complete candidate atomically: corrupt/conflicting saves fall back.
      if (saved?.bindings && typeof saved.bindings === 'object') {
        const candidate = {}, used = new Set();
        let valid = true;
        for (const item of actions(group, preset)) {
          const codes = saved.bindings[item.id] ?? result[group].bindings[item.id];
          if (!Array.isArray(codes) || !codes.length || codes.length > 2) { valid = false; break; }
          candidate[item.id] = [...new Set(codes.map(canonical))];
          for (const code of candidate[item.id]) {
            if (!validKey(code) || used.has(code)) valid = false;
            used.add(code);
          }
        }
        if (valid) result[group].bindings = candidate;
      }
    }
    return result;
  }
  function setPreset(settings, group, preset) {
    if (!GROUPS[group] || !presets(group).some(item => item.id === preset)) return false;
    settings[group] = { preset, bindings: defaults(group, preset) };
    return true;
  }
  function rebind(settings, group, id, rawCode) {
    const code = canonical(rawCode), config = settings[group];
    if (!config || !Object.hasOwn(config.bindings, id)) return { error: 'Unknown control.' };
    if (!validKey(code)) return { error: 'Choose a letter, number, arrow, modifier, or punctuation key. Esc, Tab, P, M, I and G stay available for menus.' };
    const conflict = actions(group, config.preset).find(item => item.id !== id && config.bindings[item.id].includes(code));
    if (conflict) return { error: keyLabel(code) + ' is already used for ' + conflict.label.toLowerCase() + '. Choose another key first.' };
    config.bindings[id] = [code];
    return { ok: true };
  }
  function groupFor(vehicle) {
    if (vehicle?.kind === 'aircraft') return ['helicopter', 'news', 'policeheli', 'transportheli'].includes(vehicle.aircraftType) ? 'helicopter' : 'plane';
    return vehicle?.kind === 'tank' ? 'tank' : vehicle?.id === 'player' || !vehicle ? 'foot' : 'car';
  }
  function actionForKey(settings, group, code) {
    code = canonical(code);
    return Object.keys(settings[group].bindings).find(id => settings[group].bindings[id].includes(code));
  }
  function readInput(settings, group, keys) {
    const pressed = new Set([...keys].map(canonical)), input = {};
    for (const [id, codes] of Object.entries(settings[group].bindings)) input[id] = codes.some(code => pressed.has(code));
    return input;
  }
  const bindingLabel = (settings, group, id) => (settings[group].bindings[id] || []).map(keyLabel).join(' / ');
  return { GROUPS, presets, actions, defaults, normalizeSettings, setPreset, rebind, groupFor, actionForKey, readInput, bindingLabel, keyLabel };
});
