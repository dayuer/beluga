import { t, useT } from '../i18n/index.js';
import * as Popover from '@radix-ui/react-popover';
import { useState } from 'react';
import type { DeviceView, PhoneUse } from '../../../../src/companion/protocol.js';
import { Icon } from '../components/Icon.js';
import { Button, cx } from '../components/ui.js';
import { useApp, useBeluga } from '../lib/beluga.js';
import { sameDeep } from '../lib/stable.js';
import { useClock } from '../lib/window-active.js';
import { QrCode } from '../network/QrCode.js';
import { errorText, quietly } from '../network/use-net.js';
import { Group, Row, Select } from '../dialogs/settings-controls.js';
import type { KeepAwake } from '@beluga/shared/settings-schema.js';
import { pathLabel } from '../../../../src/companion/diagnose.js';
import { DEFAULT_INVITE_DAYS, INVITE_DAYS, clientInviteArgs, leftText, markOf, seenText } from './phone-model.js';
import p from '../dialogs/native/person.module.css';
import s from './phone.module.css';
import { computerWord, thisComputer, upFirst, yourComputer } from '../lib/os-words.js';

/**
 * Your phone on the Mac (docs/companion.md, "On the Mac"): a small mark in the sidebar's footer
 * while a phone is paired (lit with a dot while it's linked, outlined while it's away), its
 * popover with the phones and Pair a Phone…, and Settings › Phone with the same.
 */

/** A clock for "last seen 12 min ago" (it rests while you look away). */
const useMinute = (): number => useClock(true, 30_000);

const useDevices = (): readonly DeviceView[] => useApp((st) => st.companion.devices, sameDeep);
const usePairing = () => useApp((st) => st.companion.pairing, sameDeep);
const useRelay = () => useApp((st) => st.companion.relay);
const useAdb = () => useApp((st) => st.companion.adb, sameDeep);

/** How Claude may use this phone (BLG-150): the preset, the route it's reached by, and adb pairing. */
const USE_OPTIONS = (): ReadonlyArray<{ value: PhoneUse; label: string }> => [
  { value: 'off', label: t('phone.use.off') },
  { value: 'ask', label: t('phone.use.ask') },
  { value: 'use', label: t('phone.use.use') },
  { value: 'full', label: t('phone.use.full') },
];
const ROUTE_WORDS: Record<string, string> = {
  get usb() { return t('phone.route.usb'); },
  get wifi() { return t('phone.route.wifi'); },
  get link() { return t('phone.route.link'); },
  get accessibility() { return t('phone.route.accessibility'); },
};

function PhoneClaude({ d }: { d: DeviceView }) {
  const { client } = useBeluga();
  useT();
  const c = d.control;
  if (!c || d.platform === 'ios') return null;
  const route = c.routes[0];
  return (
    <div className={s.control}>
      <Row label={t('phone.letUse')} detail={route ? t('phone.reachedBy', { how: ROUTE_WORDS[route] ?? route }) : (c.note ?? t('phone.notReachable'))}>
        <Select label={t('phone.letUse')} value={c.use} onChange={(v) => void client.api.companion['phone.use'](d.id, v as PhoneUse)} options={USE_OPTIONS().map((o) => ({ ...o }))} />
      </Row>
      {c.use !== 'off' && c.accessibility !== true ? <BelugaLink id={d.id} reachable={c.usb === true || c.adb === 'connected' || c.adb === 'ready'} /> : null}
      {c.use !== 'off' && (c.usb || c.adb !== 'off') ? <OverWifi id={d.id} on={c.adb !== undefined && c.adb !== 'off'} cable={c.usb === true} path={c.wifiPath} /> : null}
      {c.use !== 'off' && c.adb === 'unpaired' ? (
        <Row label={t('phone.wireless')} detail={t('phone.wirelessDetail')}>
          <Button size="small" onClick={() => void quietly(client, client.api.companion['phone.pairAdb'](d.id))}>
            {t('phone.connect')}
          </Button>
        </Row>
      ) : null}
    </div>
  );
}

/**
 * Beluga Link (BLG-391): the phone's small add-on app with the Accessibility service, which lets
 * Claude tap and type without a cable. Installed from here over adb, Play Protect doesn't block it
 * and it's turned on too.
 */
function BelugaLink({ id, reachable }: { id: string; reachable: boolean }) {
  const { client } = useBeluga();
  useT();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string>();
  const go = async (): Promise<void> => {
    setBusy(true);
    setSaid(undefined);
    try {
      setSaid(await client.api.companion['phone.setUpLink'](id));
    } catch (err) {
      setSaid(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const detail = reachable
    ? t('phone.link.reachable', { computer: upFirst(thisComputer()) })
    : t('phone.link.unreachable');
  return (
    <Row label="Beluga Link" detail={said ?? detail}>
      <Button size="small" disabled={busy || !reachable} onClick={() => void go()}>
        {busy ? t('phone.link.settingUp') : t('phone.link.setUp')}
      </Button>
    </Row>
  );
}

/**
 * Wireless debugging (BLG-187): on over the cable so Claude and the mirror carry on unplugged, or
 * off. It's only ever reached through Beluga's encrypted link, and goes off by itself when unused.
 */
function OverWifi({ id, on, cable, path }: { id: string; on: boolean; cable: boolean; path?: 'direct' | 'blocked' }) {
  const { client } = useBeluga();
  useT();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string>();
  const go = async (next: boolean): Promise<void> => {
    setBusy(true);
    setSaid(undefined);
    try {
      setSaid(await client.api.companion['phone.wifi'](id, next));
    } catch (err) {
      setSaid(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const way =
    path === 'blocked'
      ? t('phone.wifi.blocked', { computer: computerWord() })
      : path === 'direct'
        ? t('phone.wifi.direct', { computer: computerWord() })
        : t('phone.wifi.either');
  const detail = on ? t('phone.wifi.on', { way }) : t('phone.wifi.off', { way });
  return (
    <Row label={t('phone.wifi.label')} detail={said ?? detail}>
      {on ? (
        <Button size="small" disabled={busy} onClick={() => void go(false)}>
          {busy ? t('phone.wifi.turningOff') : t('phone.wifi.turnOff')}
        </Button>
      ) : (
        <Button size="small" disabled={busy || !cable} onClick={() => void go(true)}>
          {busy ? t('phone.wifi.waiting') : t('phone.wifi.use')}
        </Button>
      )}
    </Row>
  );
}

/** How phones on other networks (a dorm's or a café's Wi-Fi, mobile data) reach this Mac, in a line (BLG-126). */
export function relayText(relay: 'ready' | 'starting' | 'off' | undefined): { readonly text: string; readonly ok: boolean } | undefined {
  if (relay === 'ready') return { text: t('phone.relay.ready', { computer: thisComputer() }), ok: true };
  if (relay === 'starting') return { text: t('phone.relay.starting'), ok: false };
  if (relay === 'off') return { text: t('phone.relay.off', { computer: thisComputer() }), ok: false };
  return undefined;
}

const KEEP_AWAKE_OPTIONS = (): ReadonlyArray<{ value: KeepAwake; label: string }> => [
  { value: 'off', label: t('phone.awake.never') },
  { value: 'power', label: t('phone.awake.power') },
  { value: 'always', label: t('phone.awake.always') },
];

/** Whether phones reach this Mac from anywhere now, and keeping it awake for them. */
function Reaching() {
  const { client } = useBeluga();
  useT();
  const relay = relayText(useRelay());
  const keepAwake = useApp((st) => st.prefs.keepAwake ?? 'off');
  return (
    <>
      {relay ? (
        <Row label={t('phone.relay.label')} detail={relay.text}>
          <span className={cx(s.relayDot, relay.ok && s.relayOk)} aria-label={relay.ok ? t('phone.relay.okLabel') : t('phone.relay.notOk')} />
        </Row>
      ) : null}
      <Row label={t('phone.awake.label', { computer: thisComputer() })} detail={t('phone.awake.detail', { computer: computerWord() })}>
        <Select label={t('phone.awake.label', { computer: thisComputer() })} value={keepAwake} onChange={(v) => void client.api.session.setPrefs({ keepAwake: v })} options={KEEP_AWAKE_OPTIONS().map((o) => ({ ...o }))} />
      </Row>
    </>
  );
}

/** The phones you paired: each with how it is now, Remove, and (in Settings) how Claude may use it. */
function DeviceList({ now, control = false }: { now: number; control?: boolean }) {
  const { client } = useBeluga();
  useT();
  const devices = useDevices();
  if (!devices.length) return <div className={s.empty}>{t('phone.list.empty')}</div>;
  return (
    <ul className={s.devices} aria-label={t('phone.list.yourPhones')}>
      {devices.map((d) => (
        <li key={d.id} className={s.device}>
          <div className={s.deviceHead}>
            <span className={cx(s.deviceMark, d.linked && s.lit)} aria-hidden="true">
              <Icon name="phone" size={16} />
            </span>
            <span className={s.deviceText}>
              <span className={s.deviceName}>{d.name}</span>
              <span className={s.dim}>
                {d.platform === 'ios' ? 'iPhone' : 'Android'}
                {d.app ? t('phone.list.app', { v: d.app }) : ''} · {seenText(d, now)}
              </span>
              {d.path ? (
                <span className={s.path} title={d.note}>
                  {d.path === 'relay' ? (d.note ?? pathLabel(d.path)) : pathLabel(d.path)}
                </span>
              ) : null}
            </span>
            <Button size="small" variant="quiet" onClick={() => void client.api.companion['devices.remove'](d.id)}>
              {t('phone.list.remove')}
            </Button>
          </div>
          {control ? <PhoneClaude d={d} /> : null}
        </li>
      ))}
    </ul>
  );
}

/** Pair a Phone…: the QR and the code while a pairing is open, and "Pair this phone?" once one is waiting (also on the welcome's phone step). */
export function Pairing({ now }: { now: number }) {
  const { client } = useBeluga();
  useT();
  const pairing = usePairing();
  const devices = useDevices();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const start = async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      await quietly(client, client.api.companion['pair.start']());
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  if (!pairing) {
    // While it opens it stays the same button, the same size (both labels take the room): a spinner and "Opening…", readable.
    return (
      <div className={s.pairRow}>
        {error ? <div className={s.error}>{error}</div> : null}
        <Button variant={devices.length ? 'plain' : 'primary'} className={cx(s.pairButton, busy && s.opening, busy && devices.length > 0 && s.openingPlain)} disabled={busy || devices.length >= 4} aria-busy={busy || undefined} onClick={() => void start()}>
          <span className={s.pairFace} data-shown={busy ? undefined : 'true'}>
            <Icon name="phone" size={14} />
            {t('onboarding.phoneStep.pair')}
          </span>
          <span className={s.pairFace} data-shown={busy ? 'true' : undefined}>
            <span className={s.spinner} aria-hidden="true" />
            {t('onboarding.phoneStep.opening')}
          </span>
        </Button>
      </div>
    );
  }
  if (pairing.waiting) {
    return (
      <div className={s.pairing}>
        <div className={s.pairTitle}>{t('phone.pair.title', { name: pairing.waiting.name })}</div>
        <div className={s.fingerprint} aria-label={t('phone.pair.fingerprint', { f: pairing.waiting.fingerprint })}>
          {pairing.waiting.fingerprint}
        </div>
        <div className={s.dim}>{t('phone.pair.same')}</div>
        <div className={s.buttons}>
          <Button onClick={() => void client.api.companion['pair.cancel']()}>{t('phone.pair.dont')}</Button>
          <Button variant="primary" onClick={() => void client.api.companion['pair.approve']()}>
            {t('phone.pair.pair')}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className={s.pairing}>
      <div className={s.qr}>
        <QrCode text={pairing.link} size={148} label={t('phone.pair.scan')} />
      </div>
      <div className={s.dim}>{t('phone.pair.scanOr')}</div>
      <div className={s.code}>{pairing.code}</div>
      <div className={s.dim}>{t('phone.pair.once', { left: leftText(pairing.expiresAt, now) })}</div>
      <div className={s.buttons}>
        <Button onClick={() => void client.api.companion['pair.cancel']()}>{t('phone.pair.cancel')}</Button>
      </div>
    </div>
  );
}

/**
 * 邀请客户 (BLG-33): a pairing for a customer's phone, tied to one project and good for a day or
 * more. It shows the same link and code as Pair a Phone…; what pairs becomes that project's client.
 */
export function ClientInvite({ now }: { now: number }) {
  const { client } = useBeluga();
  useT();
  const projects = useApp((st) => st.projects.filter((x) => x.root && !x.error), sameDeep);
  const pairing = usePairing();
  const [project, setProject] = useState<string>();
  const [days, setDays] = useState(DEFAULT_INVITE_DAYS);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const chosen = project ?? projects[0]?.id;
  if (pairing) {
    // An invite is open: its link and code (or "Pair this phone?"); a pairing of your own phone isn't this group's.
    if (!pairing.project) return <div className={s.dim}>{t('phone.invite.busy')}</div>;
    const name = projects.find((x) => x.id === pairing.project)?.name ?? pairing.project;
    return (
      <>
        <div className={s.dim}>{t('phone.invite.for', { project: name })}</div>
        <Pairing now={now} />
      </>
    );
  }
  if (!projects.length) return <div className={s.dim}>{t('phone.invite.none')}</div>;
  const start = async (): Promise<void> => {
    if (!chosen) return;
    setBusy(true);
    setError(undefined);
    try {
      await quietly(client, client.api.companion['pair.start'](clientInviteArgs(chosen, days)));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Row label={t('phone.invite.project')} detail={t('phone.invite.projectDetail')}>
        <Select label={t('phone.invite.project')} value={chosen ?? ''} onChange={setProject} options={projects.map((x) => ({ value: x.id, label: x.name }))} />
      </Row>
      <Row label={t('phone.invite.valid')} detail={t('phone.invite.validDetail')}>
        <Select label={t('phone.invite.valid')} value={String(days)} onChange={(v) => setDays(Number(v))} options={INVITE_DAYS.map((d) => ({ value: String(d), label: t('phone.invite.days', { n: d }) }))} />
      </Row>
      <div className={s.pairRow}>
        {error ? <div className={s.error}>{error}</div> : null}
        <Button variant="primary" disabled={busy || !chosen} aria-busy={busy || undefined} onClick={() => void start()}>
          {t('phone.invite.button')}
        </Button>
      </div>
    </>
  );
}

/** The popover's line about the relay, only when it isn't ready (that's the news). */
function RelayLine() {
  const relay = useRelay();
  useT();
  const said = relay === 'ready' ? undefined : relayText(relay);
  return said ? <div className={s.relayLine}>{said.text}</div> : null;
}

/** The sidebar footer's phone mark (only once a phone is paired, or while pairing one). */
export function PhoneMark() {
  const devices = useDevices();
  const pairing = usePairing();
  const now = useMinute();
  useT();
  if (!devices.length && !pairing) return null;
  const { lit, title } = markOf(devices, now);
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className={cx(s.mark, lit && s.lit)} title={title} aria-label={t('phone.mark.label', { title })}>
          <Icon name="phone" size={14} />
          {lit ? <span className={s.markDot} aria-hidden="true" /> : null}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className={cx(p.card, s.card)} side="top" align="end" sideOffset={8} collisionPadding={10} aria-label={t('phone.mark.yourPhone')}>
          <div className={s.head}>{t('onboarding.phoneStep.eyebrow')}</div>
          <DeviceList now={now} />
          <RelayLine />
          <Pairing now={now} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Whether adb (Android platform-tools) is on this Mac — needed for Wireless debugging, screenshots and shell. */
function AdbLine() {
  const adb = useAdb();
  useT();
  if (!adb) return null;
  const detail = adb.path
    ? t('phone.adb.found', { v: adb.version ?? '', computer: thisComputer() })
    : adb.fetching
      ? t('phone.adb.getting')
      : t('phone.adb.missing');
  return (
    <Row label={t('phone.adb.label', { computer: thisComputer() })} detail={detail}>
      {adb.path ? <span className={cx(s.relayDot, s.relayOk)} aria-label={t('phone.adb.foundLabel')} /> : <span className={s.relayDot} aria-label={t('phone.adb.notFound')} />}
    </Row>
  );
}

/**
 * A phone on this Mac's USB cable (BLG-190): what to switch on, said plainly (and shown on the phone
 * when its Beluga can), or pair it over the cable.
 */
function OnTheCable() {
  const { client } = useBeluga();
  useT();
  const cable = useAdb()?.cable;
  const devices = useDevices();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string>();
  if (!cable) return null;
  const linked = devices.find((d) => d.platform !== 'ios' && d.linked);
  const run = async (work: () => Promise<string | void>): Promise<void> => {
    setBusy(true);
    setSaid(undefined);
    try {
      setSaid((await work()) || undefined);
    } catch (err) {
      setSaid(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  // Developer options, or About phone when they aren't on yet (tap Build number seven times there).
  const showOnPhone = (): Promise<string> =>
    client.api.companion['phone.settings'](linked!.id, 'developer').then(
      () => t('phone.cable.devOpen'),
      () => client.api.companion['phone.settings'](linked!.id, 'about').then(() => t('phone.cable.aboutOpen')),
    );
  const name = cable.name;
  if (cable.state === 'no-debugging')
    return (
      <Row label={t('phone.cable.label')} detail={said ?? t('phone.cable.noDebugging', { name })}>
        {linked ? (
          <Button size="small" disabled={busy} onClick={() => void run(showOnPhone)}>
            {t('phone.cable.openOnPhone')}
          </Button>
        ) : (
          <span />
        )}
      </Row>
    );
  if (cable.state === 'unauthorized') return <Row label={t('phone.cable.label')} detail={t('phone.cable.unauthorized', { name })}><span /></Row>;
  if (cable.canPair)
    return (
      <Row label={t('phone.cable.label')} detail={said ?? t('phone.cable.canPair', { name, computer: thisComputer() })}>
        <Button size="small" disabled={busy} onClick={() => void run(() => client.api.companion['phone.pairCable']())}>
          {busy ? t('onboarding.phoneStep.opening') : t('phone.cable.pairOver')}
        </Button>
      </Row>
    );
  return <Row label={t('phone.cable.label')} detail={t('phone.cable.ok', { name })}><span /></Row>;
}

/** Settings › Phone. */
export function PhoneSettings() {
  const now = useMinute();
  useT();
  const cable = useAdb()?.cable;
  return (
    <>
      {cable ? (
        <Group title={t('phone.cable.label')}>
          <OnTheCable />
        </Group>
      ) : null}
      <Group title={t('phone.list.yourPhones')}>
        <div className={s.inSettings}>
          <DeviceList now={now} />
        </div>
      </Group>
      {useDevices().some((d) => d.platform !== 'ios') ? (
        <Group title={t('phone.settings.letUse')}>
          <Row label={t('phone.settings.how')} detail={t('phone.settings.howDetail', { computer: thisComputer() })}>
            <span />
          </Row>
          <AdbLine />
          <div className={s.inSettings}>
            <DeviceList now={now} control />
          </div>
        </Group>
      ) : null}
      {useDevices().length ? (
        <Group title={t('phone.settings.reaching', { computer: yourComputer() })}>
          <Reaching />
        </Group>
      ) : null}
      <Group title={t('phone.model.pair')}>
        <Row label={t('phone.settings.app')} detail={t('phone.settings.appDetail', { computer: yourComputer() })}>
          <span />
        </Row>
        <div className={s.inSettings}>{usePairing()?.project ? null : <Pairing now={now} />}</div>
      </Group>
      <Group title={t('phone.invite.title')}>
        <div className={s.inSettings}>
          <ClientInvite now={now} />
        </div>
      </Group>
    </>
  );
}
