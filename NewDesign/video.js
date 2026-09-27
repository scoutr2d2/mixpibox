/* =====================================================================
   MixPiBox — DIE BELOHNUNGS-VIDEOS AUF DEM KINDERSCHIRM
   =====================================================================

   Betreiber, 20.09.2026: „ard videos einzelne videos freischalten mit
   abspiel haeufigkeit es soll quasi eine belohnung sein. Mal ein
   freigegebenes Video nicht zum dauer konsumieren."

   ── WARUM EINE EIGENE DATEI UND KEIN PLUGIN ─────────────────────────────

   Dieselbe Antwort wie bei apps.js, und sie steht dort ausfuehrlich: Der
   Plugin-Vertrag schliesst kinderseitige Oberflaeche ausdruecklich aus
   („fremdes JS in der Kiosk-Seite haette volles DOM und alle fetch-Rechte").
   Das ARD-WISSEN ist trotzdem ein Plugin (`mixpi-mediathek`) — nur eben auf
   der anderen Seite des Tors. Diese Datei hier zeigt lediglich, was der KERN
   fuer dieses Profil freigegeben hat.

   ── WARUM NICHT IN app.js ───────────────────────────────────────────────

   app.js liegt bei 1,64 MB und damit auf 99 % ihres Deckels. Eine eigene
   Datei, ein eigener Deckel, eine eigene Zeile in der Groessen-Wache — genau
   der Schnitt, den apps.js am 03.09.2026 gemacht hat.

   ── DIE EINE HARTE REGEL DIESES HAUSES, UND WIE SIE HIER GILT ───────────

   „Keine App spielt Musik ab" (apps.js). Diese Datei spielt sehr wohl etwas
   ab — und genau deshalb geht sie NICHT am Kern vorbei:

     * Die Liste kommt aus `GET /api/video/kind`. Der Server entscheidet,
       WAS darin steht; hier wird nichts gefiltert und nichts gemerkt.
     * Die Adresse kommt aus `POST /api/video/start`. Ohne Freigabe gibt es
       403 mit Grund — und hier keine Adresse, die man doch benutzen koennte.
     * Verbraucht wird ueber `POST /api/video/gesehen`. Der Server haelt die
       Schwelle (90 %) und die Laufkennung; diese Seite MELDET nur.

   Der Ton der Box wird vorher angehalten (`spielerBefehl('pause')`), sonst
   liefen Hoerspiel und Video uebereinander.

   ── EIN VIDEO KANN EIN STUECK SEIN (20.09.2026) ─────────────────────────

   Betreiber: „marker im video setzen zu koennen um definerte stuecke zumachen
   eine 25 min maus ist ggf zu lange". Eine Freigabe traegt deshalb einen
   Schnitt (`abSek`/`bisSek`), und der Kern schickt ihn beim Start mit.

   DREI DINGE FOLGEN DARAUS, und alle drei sind hier leicht zu uebersehen:

     * GESPRUNGEN WIRD NACH `loadedmetadata`. Ein `currentTime` davor
       verpufft — der Spieler weiss noch nicht, wie lang die Datei ist.
     * ANGEHALTEN WIRD BEI `bisSek`. Ohne das liefe das Stueck ins naechste
       hinein, und die Belohnung waere eine andere als die freigegebene.
     * GEMESSEN WIRD GEGEN DAS STUECK. `anteilAus` rechnet seit diesem Tag
       gegen `laufend.laenge` und nicht gegen `spieler.duration` — gegen die
       Videolaenge erreichte ein Fuenf-Minuten-Stueck eines 25-Minuten-Videos
       die Schwelle NIE und liefe unbegrenzt oft. Gemeldet werden zusaetzlich
       SEKUNDEN, damit der Server die Bezugsgroesse nicht von hier erfragen
       muss, sondern in seiner eigenen Ablage nachsieht.

   ── WAS DIESE DATEI NICHT TUT ───────────────────────────────────────────

   Sie sucht nicht, sie blaettert nicht, sie schlaegt nichts vor. Eine
   Mediathek zum Durchstoebern waere das Gegenteil des Auftrags („nicht zum
   dauer konsumieren"). Was nicht freigegeben ist, ist hier nicht zu sehen.
   ===================================================================== */
;(() => {
  'use strict'

  /* ── WAS DAS HAUS HEREINREICHT ─────────────────────────────────────────
   * Dieselbe Bauart wie bei apps.js: eine LESBARE Grenze, keine Sandkiste.
   * `spielerBefehl` ist der einzige Weg zum Ton, und er geht durch denselben
   * Flaschenhals wie jeder andere Befehl der Oberflaeche. */
  let el = null
  let API = '/api'
  let spielerBefehl = null
  let sprichDann = null
  /**
   * DER LAUTSTAERKE-GRIFF DES HAUSES — drei Funktionen, nicht das Objekt.
   *
   * NUR LESEN: `wert()` und `max()`, damit der Regler beim Aufziehen auf dem
   * Stand des Hauses steht statt auf 0 („der Ton ist aus", liest ein Kind
   * daraus). GESTELLT wird er von app.js selbst — dort haengt ein Zuhoerer
   * an jedem `[data-laut-regler]`, und dieser traegt das Merkmal. `setzen`
   * reist trotzdem mit, weil ein Griff, der nur die halbe Sache kann, beim
   * naechsten Bedarf nachgebaut wird.
   */
  let lautstaerke = null

  /** Die freigegebenen Videos, wie der Server sie zuletzt genannt hat. */
  let liste = []

  /**
   * Der laufende Anschauvorgang — oder `null`.
   * `{ id, lauf, ab, bis, laenge, gemeldet }`. `gemeldet` verhindert, dass dieselbe
   * Sichtung zweimal hinausgeht; der Server faengt es zwar noch einmal ab
   * (er zaehlt je Laufkennung hoechstens einmal), aber eine Meldung, die man
   * gar nicht erst schickt, kann auch nicht als Doppelklick ankommen.
   */
  let laufend = null

  /** Die Schwelle ist die des SERVERS — hier steht sie nur fuer die Meldung. */
  const SCHWELLE = 0.9

  function $(id) {
    return document.getElementById(id)
  }

  /**
   * LESEN und SCHREIBEN sind ZWEI Funktionen, nicht eine mit Schalter.
   *
   * Das ist hier nicht Geschmack: `tools/vorschau-routen-deckung.mjs` sammelt
   * die LESENDEN Routen der Oberflaeche an den Aufrufen von `json` mit der
   * API-Basis davor und ruft jede davon mit GET gegen die Attrappe. (Das
   * Muster steht hier ABSICHTLICH nicht woertlich: geschrieben taete es der
   * Wache wie ein echter Ruf aussehen, und sie verlangte eine Antwort auf
   * einen Pfad namens „…" — [[prosa-ist-kein-ruf]], hier beim Schreiben
   * dieses Kommentars prompt einmal passiert.) Ein POST-Weg, der ueber
   * denselben Helfer liefe, waere darin als lesend gefuehrt — die Wache
   * verlangte dann eine GET-Antwort fuer etwas, das nur POST kennt, und
   * waere dauerrot. Dieselbe Trennung haelt app.js seit jeher.
   */
  async function json(pfad) {
    const antwort = await fetch(pfad, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(12000),
    })
    const rumpf = await antwort.json().catch(() => ({}))
    return { ok: antwort.ok, status: antwort.status, rumpf }
  }

  /** Etwas hinschicken. Antwortet in derselben Form wie `json`. */
  async function schicken(pfad, rumpf) {
    const antwort = await fetch(pfad, {
      method: 'POST',
      cache: 'no-store',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(rumpf),
      signal: AbortSignal.timeout(12000),
    })
    const inhalt = await antwort.json().catch(() => ({}))
    return { ok: antwort.ok, status: antwort.status, rumpf: inhalt }
  }

  /* ══ DIE REIHE ═══════════════════════════════════════════════════════ */

  /**
   * Die Liste holen. Fehlschlag heisst: KEINE Reihe, nicht die alte.
   *
   * Eine stehengebliebene Kachel aus einer alten Antwort waere hier teuer:
   * sie koennte ein Video zeigen, das dem KIND VON VORHIN gehoert. Ein
   * Profilwechsel geht genau durch diesen Weg.
   */
  async function holen() {
    try {
      const a = await json(`${API}/video/kind`)
      liste = a.ok && Array.isArray(a.rumpf?.videos) ? a.rumpf.videos : []
    } catch {
      liste = []
    }
  }

  /** Die Reihe neu malen. Ohne Freigaben faellt sie ganz weg. */
  function zeichnen() {
    const kasten = $('video')
    const reihe = $('video-reihe')
    if (!kasten || !reihe) return
    if (!liste.length) {
      kasten.hidden = true
      reihe.textContent = ''
      return
    }
    kasten.hidden = false
    reihe.textContent = ''
    const stapel = document.createDocumentFragment()
    for (const v of liste) {
      const knopf = el('button', 'video-kachel')
      knopf.type = 'button'
      // DER VORLESESTIMME WIRD GESAGT, WAS UEBRIG IST. „noch zweimal" ist
      // die Auskunft, die ein Kind hier wirklich braucht — sie steht auch
      // sichtbar auf der Kachel, aber wer nicht liest, hoert sie sonst nie.
      // DER TEILNAME GEHOERT ZUM NAMEN, nicht daneben: drei Kacheln mit
      // demselben Titel sind fuer ein Kind dieselbe Kachel dreimal. Die
      // Vorlesestimme bekommt denselben Satz.
      const titel = v.teil ? `${v.name} — ${v.teil}` : v.name
      knopf.setAttribute('aria-label', `${titel}, noch ${v.rest} mal anschauen`)
      const bildkasten = el('div', 'video-bild')
      // EIN ZEICHEN STATT EINES LEEREN KASTENS. Ein Video ohne Bild gibt es:
      // die ARD liefert nicht zu jeder Folge eines, und eine Freigabe von
      // Hand hat gar keines. Ein leeres Rechteck sieht aus wie ein Fehler —
      // dasselbe Argument wie beim Buchstaben auf der Weiterhoeren-Kachel.
      bildkasten.appendChild(el('span', 'video-zeichen', '▶'))
      if (v.bild) {
        const bild = el('img')
        bild.src = v.bild
        bild.alt = ''
        bild.loading = 'lazy'
        bild.addEventListener('error', () => bild.remove(), { once: true })
        bildkasten.appendChild(bild)
      }
      // DIE ZAHL LIEGT AUF DEM BILD und nicht darunter: auf 480 px Hoehe
      // kostet jede zusaetzliche Textzeile in einer Reihe echte Kacheln.
      bildkasten.appendChild(el('span', 'video-rest', `${v.rest}×`))
      knopf.appendChild(bildkasten)
      knopf.appendChild(el('span', 'video-name', titel))
      knopf.addEventListener('click', () => void oeffnen(v))
      stapel.appendChild(knopf)
    }
    reihe.appendChild(stapel)
  }

  /** Holen UND malen — das, was das Haus ruft. */
  async function aktualisieren() {
    await holen()
    zeichnen()
  }

  /* ══ DER SCHIRM ══════════════════════════════════════════════════════ */

  function sagen(text) {
    const feld = $('video-wort')
    if (feld) feld.textContent = text
    if (typeof sprichDann === 'function' && text) {
      try {
        sprichDann(text)
      } catch {
        /* die Stimme ist Zugabe, kein Weg */
      }
    }
  }

  /**
   * Ein Video starten.
   *
   * DIE REIHENFOLGE IST DER PUNKT:
   *   1. beim Kern anfragen — ohne Freigabe gibt es hier gar keine Adresse,
   *   2. den Ton der Box anhalten,
   *   3. erst dann den Schirm aufziehen und abspielen.
   *
   * Umgekehrt saehe das Kind einen schwarzen Vollbildschirm und danach eine
   * Absage — und der Ton liefe weiter, wenn die Absage kommt.
   */
  async function oeffnen(v) {
    const schirm = $('video-schirm')
    const spieler = $('video-spieler')
    if (!schirm || !spieler) return
    let a
    try {
      // `id` IST DIE ZEILE, `kennung` das Video. Bei einem ganzen Video sind
      // beide gleich; bei einem Stueck traefe die Kennung nichts.
      a = await schicken(`${API}/video/start`, { id: v.id || v.kennung })
    } catch {
      sagen('Das Video ist gerade nicht zu erreichen.')
      schirmZeigen(true)
      return
    }
    if (!a.ok) {
      // JEDER GRUND BEKOMMT SEINEN EIGENEN SATZ. „Geht nicht" ist an einem
      // Kinderschirm die Auskunft, nach der jemand einen Erwachsenen holt.
      const grund = String(a.rumpf?.grund ?? '')
      sagen(
        grund === 'aufgebraucht'
          ? 'Dieses Video ist aufgebraucht.'
          : grund === 'unbekannt'
            ? 'Dieses Video ist nicht freigegeben.'
            : grund === 'nicht mehr in der Mediathek'
              ? 'Dieses Video gibt es in der Mediathek nicht mehr.'
              : 'Das Video lässt sich gerade nicht holen.',
      )
      schirmZeigen(true)
      // Die Reihe kann veraltet sein (ein zweiter Schirm, ein Elternteil am
      // Laptop) — nach einer Absage wird sie deshalb nachgezogen.
      void aktualisieren()
      return
    }

    // DER TON DER BOX GEHT AUS, bevor das Bild kommt. Ohne das laufen
    // Hoerspiel und Video uebereinander, und die Lautstaerketasten regeln
    // das Falsche.
    if (typeof spielerBefehl === 'function') {
      try {
        await spielerBefehl('pause')
      } catch {
        /* kein Ton ist kein Grund, das Video nicht zu zeigen */
      }
    }

    const ab = Math.max(0, Number(a.rumpf?.abSek) || 0)
    const bis = Math.max(0, Number(a.rumpf?.bisSek) || 0)
    laufend = {
      id: String(a.rumpf?.id ?? v.id ?? v.kennung ?? ''),
      lauf: String(a.rumpf?.lauf ?? ''),
      ab,
      bis,
      // DIE LAENGE KOMMT VOM SERVER und wird hier nicht nachgerechnet: er
      // fuehrt die Ablage, und die Schwelle ist seine.
      laenge: Math.max(0, Number(a.rumpf?.laengeSek) || 0),
      gemeldet: false,
    }
    sagen('')
    // GESPRUNGEN WIRD ERST, WENN DER SPIELER DIE DATEI KENNT. Ein
    // `currentTime` vor `loadedmetadata` verpufft ohne Fehlermeldung — das
    // Stueck liefe dann von vorn, und niemandem fiele auf, warum.
    if (ab > 0) {
      spieler.addEventListener(
        'loadedmetadata',
        () => {
          try {
            spieler.currentTime = ab
          } catch {
            /* Springt die Datei nicht, laeuft sie von vorn — laestig, aber
               kein Grund, das Bild gar nicht zu zeigen. */
          }
        },
        { once: true },
      )
    }
    spieler.src = String(a.rumpf?.adresse ?? '')
    schirmZeigen(true)
    try {
      await spieler.play()
    } catch {
      // Autoplay-Sperren greifen hier nicht (der Tipp IST die Geste), aber
      // ein Netzfehler beim ersten Puffern landet ebenfalls hier.
      sagen('Das Video startet nicht.')
    }
  }

  /* ══ DIE SPIELLEISTE ══════════════════════════════════════════════════
   *
   * Betreiber, 20.09.2026: „das video braucht noch einen player menü mit
   * volume."
   *
   * SIE GEHT VON SELBST WEG (LEISTE_MS) und kommt bei jeder Beruehrung des
   * Bildes zurueck. Ein Kind macht eine Leiste nicht wieder zu, und ueber
   * einem 27-Minuten-Film staende sie sonst 27 Minuten im Bild.
   *
   * DAMIT AENDERT SICH, WAS EIN TIPP AUF DAS BILD TUT: bis heute hielt er an,
   * jetzt holt er die Leiste. Das ist die uebliche Bedeutung einer
   * Bildberuehrung bei laufendem Video, und Anhalten hat jetzt einen
   * sichtbaren Knopf — vorher gab es dafuer gar keinen.
   */
  const LEISTE_MS = 4500
  let leisteUhr = null

  function leisteZeigen(an) {
    const leiste = $('video-leiste')
    if (!leiste) return
    leiste.classList.toggle('offen', an)
    if (leisteUhr !== null) clearTimeout(leisteUhr)
    leisteUhr = null
    // NUR WEGGEHEN, SOLANGE ETWAS LAEUFT. Steht das Bild, ist die Leiste
    // das Einzige, was noch etwas tut — sie dann auszublenden hiesse, einen
    // schwarzen Schirm ohne Bedienung zu hinterlassen.
    const spieler = $('video-spieler')
    if (an && spieler && !spieler.paused) leisteUhr = setTimeout(() => leisteZeigen(false), LEISTE_MS)
  }

  /** Sekunden als `m:ss` — ueber eine Stunde als `h:mm:ss`. */
  function zeitText(sek) {
    const s = Math.max(0, Math.floor(Number(sek) || 0))
    const st = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const r = s % 60
    return st > 0 ? `${st}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
  }

  /** Das Symbol im Knopf: zwei Balken (laeuft) oder ein Dreieck (steht). */
  function spielZeichen(paused) {
    const pfad = $('video-spiel-zeichen')
    if (!pfad) return
    pfad.setAttribute('d', paused ? 'M8 5v14l11-7z' : 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z')
    const knopf = $('video-spiel')
    if (knopf) knopf.setAttribute('aria-label', paused ? 'Weiter' : 'Anhalten')
  }

  /**
   * Fortschritt, Zeit und die Zahl neben dem Regler nachziehen.
   *
   * DIE LAUTSTAERKE WIRD HIER MITGELESEN und nicht mit einem eigenen Takt
   * geholt: `reglerAngleichen()` in app.js stellt JEDEN `[data-laut-regler]`
   * — auch diesen —, sobald sich der Wert irgendwo aendert. Die Zahl daneben
   * kennt app.js nicht; sie vom Regler abzulesen ist deshalb die einzige
   * Fassung, die nie auseinanderlaufen kann.
   */
  function leisteNachziehen() {
    const spieler = $('video-spieler')
    if (!spieler) return
    // DIE LEISTE ZEIGT DAS STUECK, nicht die Datei. Ein Kind, dem bei
    // Minute 8 von 25 der Balken halb voll erscheint, soll nicht bei
    // „halb" stehen, wenn sein Teil gleich zu Ende ist — und umgekehrt.
    const lang = laengeAus(spieler)
    const stand = sekundenAus(spieler)
    const anteil = lang > 0 ? Math.min(1, Math.max(0, stand / lang)) : 0
    const fuell = $('video-fuell')
    if (fuell) fuell.style.width = `${(anteil * 100).toFixed(1)}%`
    const balken = $('video-fortschritt')
    if (balken) balken.setAttribute('aria-valuenow', String(Math.round(anteil * 100)))
    const zeit = $('video-zeit')
    if (zeit) zeit.textContent = `${zeitText(stand)} / ${zeitText(lang)}`
    const regler = $('video-laut')
    const zahl = $('video-laut-zahl')
    if (regler && zahl) zahl.textContent = `${regler.value} %`
  }

  function schirmZeigen(an) {
    const schirm = $('video-schirm')
    if (!schirm) return
    schirm.hidden = !an
    // `hidden` verliert gegen jedes eigene `display` — deshalb traegt der
    // Schirm zusaetzlich eine Klasse, und app.css entscheidet damit.
    document.body.classList.toggle('video-laeuft', an)
    if (an) {
      // DEN REGLER AUF DEN STAND DES HAUSES STELLEN, bevor die Leiste
      // sichtbar wird: ohne das stuende dort „0 %", bis irgendwo jemand die
      // Lautstaerke anfasst — und ein Kind liest daraus „der Ton ist aus".
      const regler = $('video-laut')
      if (regler && lautstaerke) {
        regler.max = String(lautstaerke.max() || 100)
        regler.value = String(lautstaerke.wert())
      }
      spielZeichen(true)
      leisteNachziehen()
      // DIE LEISTE MACHT NICHT DIESER RUF AUF, SONDERN `play`. Der Schirm
      // geht auch OHNE Video auf — bei einer Absage steht dort ein Satz und
      // sonst nichts. Eine Spielleiste mit „0:00 / 0:00" und einem
      // Anhalten-Knopf ueber einer Absage waere eine Bedienung fuer etwas,
      // das gar nicht laeuft.
      //
      // HIER STAND `leisteZeigen(true)`, UND DIE GEGENPROBE HAT ES GEFUNDEN:
      // die Zeile herauszunehmen liess das Werkzeug GRUEN — weil `play` die
      // Leiste ohnehin aufmacht. Zwei Wege auf denselben Zustand, und der
      // zweite tat nichts als den ersten zu verdecken
      // [[gegenprobe-bleibt-gruen-ist-der-fund]].
    } else if (leisteUhr !== null) {
      clearTimeout(leisteUhr)
      leisteUhr = null
    }
  }

  /**
   * Melden, wie viel gesehen wurde.
   *
   * GEMELDET WIRD IMMER, auch bei einem Abbruch nach zehn Sekunden: nur so
   * sieht der Server den Unterschied zwischen „abgebrochen" (kostet nichts)
   * und „zu Ende gesehen". Wer nur bei Erfolg meldet, verschiebt die
   * Entscheidung hierher — und das ist die Stelle, an der sie nicht sein soll.
   */
  async function melden(anteil, sekunden) {
    if (!laufend || laufend.gemeldet) return
    const lauf = laufend.lauf
    const id = laufend.id
    laufend.gemeldet = true
    try {
      // BEIDES: `sekunden` ist die Angabe, gegen die der Server selbst
      // rechnet (er kennt die Stuecklaenge), `anteil` bleibt fuer den Fall,
      // dass die Sekunden nicht zu ermitteln waren.
      await schicken(`${API}/video/gesehen`, { id, kennung: id, lauf, anteil, sekunden })
    } catch {
      /* Die Meldung ist verloren — der Server zaehlt dann nichts. Das ist
         die harmlose Richtung: lieber ein Mal geschenkt als eines zu viel
         verbraucht. */
    }
    await aktualisieren()
  }

  /**
   * Wie viele Sekunden DES STUECKS gelaufen sind. Ohne Stand: 0.
   *
   * Bei einem ganzen Video ist `ab` gleich 0 und das hier genau die
   * Abspielzeit — die alte Bedeutung, ohne Sonderfall.
   */
  function sekundenAus(spieler) {
    const stand = Number(spieler?.currentTime)
    if (!Number.isFinite(stand)) return 0
    const ab = laufend ? laufend.ab : 0
    return Math.max(0, stand - ab)
  }

  /**
   * Wie lang das laufende Stueck ist — und was gilt, wenn niemand es weiss.
   *
   * Der Server nennt die Laenge; fehlt sie (ein alter Server, eine Antwort
   * ohne das Feld), gilt die Dauer der Datei ab dem Sprungpunkt. Das ist die
   * richtige Reihenfolge: die Ablage des Servers ist die Wahrheit, die Datei
   * nur der Rueckfall.
   */
  function laengeAus(spieler) {
    if (laufend && laufend.laenge > 0) return laufend.laenge
    const dauer = Number(spieler?.duration)
    if (!Number.isFinite(dauer) || dauer <= 0) return 0
    const ab = laufend ? laufend.ab : 0
    const bis = laufend && laufend.bis > 0 ? Math.min(laufend.bis, dauer) : dauer
    return Math.max(0, bis - ab)
  }

  /**
   * Wie viel des STUECKS gelaufen ist, 0..1. Ohne Laenge: 0.
   *
   * GEGEN DAS STUECK UND NICHT GEGEN `spieler.duration` — das ist die Falle
   * der ganzen Sache: 480 von 1500 Sekunden sind 32 % und damit nie die
   * Schwelle, obwohl das Fuenf-Minuten-Stueck zu Ende ist.
   */
  function anteilAus(spieler) {
    const lang = laengeAus(spieler)
    if (lang <= 0) return 0
    return Math.min(1, Math.max(0, sekundenAus(spieler) / lang))
  }

  /** Schirm zu — und vorher melden, wie weit es gekommen ist. */
  async function schliessen() {
    const spieler = $('video-spieler')
    const anteil = anteilAus(spieler)
    const sekunden = sekundenAus(spieler)
    if (spieler) {
      spieler.pause()
      // ERST `removeAttribute`, DANN `load()`: ein leerer `src` als
      // Zeichenkette laedt die SEITE noch einmal als Video und wirft im
      // Journal einen Fehler, der wie ein kaputtes Video aussieht.
      spieler.removeAttribute('src')
      spieler.load()
    }
    schirmZeigen(false)
    sagen('')
    await melden(anteil, sekunden)
    laufend = null
  }

  /* ══ DIE ANMELDUNG ══════════════════════════════════════════════════ */

  window.MixPiVideo = {
    /**
     * Einmal vom Haus gerufen. Liefert die beiden Griffe zurueck, die app.js
     * braucht — mehr Fläche gibt es nicht.
     */
    erzeugen(kontext) {
      el = kontext.el
      API = kontext.API || '/api'
      spielerBefehl = kontext.spielerBefehl
      sprichDann = kontext.sprichDann
      lautstaerke = kontext.lautstaerke ?? null

      const spieler = $('video-spieler')
      if (spieler) {
        // ZU ENDE HEISST GESEHEN. `ended` kommt einmal je Durchlauf; die
        // Doppelmeldung faengt `laufend.gemeldet` ab und der Server noch
        // einmal ueber die Laufkennung.
        spieler.addEventListener('ended', () => void melden(1, sekundenAus(spieler)))
        // DAS ENDE EINES STUECKS IST EIN ENDE. Ohne diese Zeile liefe Teil 1
        // in Teil 2 hinein, und das Kind saehe, was es nicht freigegeben
        // bekommen hat. Angehalten wird hier und nicht geschlossen — der
        // Schirm bleibt stehen, damit ein Kind nicht ins Leere blickt.
        spieler.addEventListener('timeupdate', () => {
          if (!laufend || laufend.bis <= 0) return
          if (Number(spieler.currentTime) < laufend.bis) return
          spieler.pause()
          void melden(1, sekundenAus(spieler))
        })
        // UND WER UEBER DIE SCHWELLE KOMMT, HAT ES GESEHEN — auch wenn der
        // Abspann laeuft und jemand vorher aufsteht. Ohne diese Zeile
        // verbrauchte nur, wer bis zur letzten Sekunde sitzen bleibt.
        spieler.addEventListener('timeupdate', () => {
          if (laufend && !laufend.gemeldet && anteilAus(spieler) >= SCHWELLE) {
            void melden(1, sekundenAus(spieler))
          }
        })
        spieler.addEventListener('error', () => sagen('Das Video lässt sich nicht abspielen.'))
        // DIE LEISTE HAENGT AN DENSELBEN EREIGNISSEN wie die Anzeige —
        // `timeupdate` kommt ohnehin viermal in der Sekunde, ein eigener
        // Takt daneben waere eine zweite Wahrheit ueber dieselbe Zahl.
        spieler.addEventListener('timeupdate', leisteNachziehen)
        spieler.addEventListener('loadedmetadata', leisteNachziehen)
        spieler.addEventListener('play', () => {
          spielZeichen(false)
          leisteZeigen(true)
        })
        // ANGEHALTEN BLEIBT DIE LEISTE STEHEN: sie ist dann das Einzige, was
        // noch etwas tut.
        spieler.addEventListener('pause', () => {
          spielZeichen(true)
          leisteZeigen(true)
        })
        // EIN TIPP AUF DAS BILD HOLT DIE LEISTE — er haelt NICHT mehr an.
        // Bis zum 20.09.2026 tat er das, weil es keinen Knopf dafuer gab;
        // jetzt gibt es einen, und „Beruehrung zeigt die Bedienung" ist,
        // was ein Video ueberall sonst auch tut. Steht die Leiste schon,
        // schickt derselbe Tipp sie wieder weg.
        spieler.addEventListener('click', () => {
          const leiste = $('video-leiste')
          leisteZeigen(!(leiste && leiste.classList.contains('offen')))
        })
      }
      const weg = $('video-weg')
      if (weg) weg.addEventListener('click', () => void schliessen())

      const spielKnopf = $('video-spiel')
      if (spielKnopf) {
        spielKnopf.addEventListener('click', () => {
          const v = $('video-spieler')
          if (!v) return
          if (v.paused) void v.play().catch(() => {})
          else v.pause()
        })
      }

      /**
       * DER REGLER IST SCHON VERDRAHTET — und das ist der Punkt.
       *
       * app.js haengt beim Start EINEN Zuhoerer an JEDEN `[data-laut-regler]`
       * (`laut.gezogen()` -> `setzen()` -> entprellt `setvolume:N` durch
       * `mupi-lautstaerke.sh`). Dieser Regler traegt das Merkmal, steht beim
       * Start schon im DOM und haengt damit ohne eine einzige Zeile hier am
       * Flaschenhals.
       *
       * HIER STAND EIN EIGENER `input`-ZUHOERER, der `lautstaerke.setzen()`
       * rief. Er tat dasselbe ein zweites Mal — zwei Wege auf denselben
       * Wert, und beim naechsten Umbau waere einer davon stehengeblieben.
       * Gefunden hat ihn die Gegenprobe: das Werkzeug blieb bei
       * abgeschaltetem eigenem Ruf gruen, weil der Weg des Hauses weiterlief
       * [[gegenprobe-bleibt-gruen-ist-der-fund]].
       *
       * WAS HIER BLEIBT, ist das, was app.js NICHT kennt: die Zahl neben dem
       * Regler und die Frist der Leiste. Und ausdruecklich NICHT
       * `spieler.volume` — das waere eine zweite, unsichtbare Skala neben
       * der des Hauses.
       */
      const regler = $('video-laut')
      if (regler) {
        regler.addEventListener('input', () => {
          const zahl = $('video-laut-zahl')
          if (zahl) zahl.textContent = `${regler.value} %`
          leisteZeigen(true)
        })
      }

      return { aktualisieren, zeichnen }
    },
  }
})()
