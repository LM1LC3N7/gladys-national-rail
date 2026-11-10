// -----------------------------------------------------------------------------
// Every text the integration publishes or shows, in English and French. A
// status message is an object `{ en, fr }` (Gladys picks the language of the
// user); the texts of the features follow the `language` setting.
// -----------------------------------------------------------------------------

const both = (en, fr) => ({ en, fr });

export const FEATURE_NAMES = {
  en: {
    departure: (rank) => (rank === 1 ? 'Next train' : `Train ${rank}`),
    info: (rank) => (rank === 1 ? 'Next train details' : `Train ${rank} details`),
    summary: 'Departure board',
    messages: 'Disruption messages',
  },
  fr: {
    departure: (rank) => (rank === 1 ? 'Prochain train' : `Train ${rank}`),
    info: (rank) => (rank === 1 ? 'Détails du prochain train' : `Détails du train ${rank}`),
    summary: 'Tableau des départs',
    messages: 'Messages de perturbation',
  },
};

export const WORDS = {
  en: {
    onTime: 'on time',
    late: (minutes, at) => `${minutes} min late (expected ${at})`,
    lateShort: (minutes) => `+${minutes}`,
    delayed: 'delayed',
    cancelled: 'cancelled',
    unknown: 'no report',
    platform: (platform) => `platform ${platform}`,
    noTrain: 'No train in the next two hours',
    noMessage: 'No disruption message',
    station: 'station',
  },
  fr: {
    onTime: 'à l’heure',
    late: (minutes, at) => `retard ${minutes} min (prévu ${at})`,
    lateShort: (minutes) => `+${minutes}`,
    delayed: 'retardé',
    cancelled: 'supprimé',
    unknown: 'sans information',
    platform: (platform) => `voie ${platform}`,
    noTrain: 'Aucun train dans les deux prochaines heures',
    noMessage: 'Aucun message de perturbation',
    station: 'gare',
  },
};

/** "HH:MM" of a pause end, written in the status (London time: the service is British). */
export const STATUS = {
  starting: both('Starting…', 'Démarrage…'),
  configRetry: both(
    'The configuration could not be read from Gladys; trying again.',
    'La configuration n’a pas pu être lue depuis Gladys ; nouvel essai en cours.',
  ),
  noKey: both(
    'Paste your Rail Data Marketplace consumer key (free) in the configuration, then save.',
    'Collez votre clé « consumer key » du Rail Data Marketplace (gratuite) dans la configuration, puis enregistrez.',
  ),
  invalidKey: both(
    'The key holds characters a Rail Data Marketplace key never has: paste it again, without spaces.',
    'La clé contient des caractères qu’une clé du Rail Data Marketplace n’a jamais : collez-la de nouveau, sans espace.',
  ),
  invalidUrl: both(
    'The API address is not a Rail Data Marketplace address (https://….raildata.org.uk): the default one is used.',
    'L’adresse de l’API n’est pas une adresse du Rail Data Marketplace (https://….raildata.org.uk) : l’adresse par défaut est utilisée.',
  ),
  noBoard: both(
    'Type at least one station code (three letters, e.g. PAD) in “Boards”, then save.',
    'Tapez au moins un code de gare (trois lettres, ex. PAD) dans « Tableaux », puis enregistrez.',
  ),
  invalidBoards: (positions) =>
    both(
      `Entry ${positions.join(', ')} of “Boards” is not understood (expected: PAD, RDG>PAD:To work).`,
      `L’entrée ${positions.join(', ')} de « Tableaux » n’est pas comprise (attendu : PAD, RDG>PAD:Travail).`,
    ),
  tooManyBoards: (max) =>
    both(
      `Only the first ${max} boards are watched.`,
      `Seuls les ${max} premiers tableaux sont suivis.`,
    ),
  notCreated: both(
    'Open the “Discover” tab of this integration and add your boards.',
    'Ouvrez l’onglet « Découverte » de cette intégration et ajoutez vos tableaux.',
  ),
  refused: (status) =>
    both(
      `The Rail Data Marketplace refused the key (HTTP ${status}): check it, and that it is subscribed to the “Live Departure Board” product, then save or press “Test the connection”. No automatic retry.`,
      `Le Rail Data Marketplace a refusé la clé (HTTP ${status}) : vérifiez-la, et qu’elle est abonnée au produit « Live Departure Board », puis enregistrez ou cliquez sur « Tester la connexion ». Aucun nouvel essai automatique.`,
    ),
  paused: (at) =>
    both(
      `The Rail Data Marketplace asked to slow down: reads paused until ${at} (UK time).`,
      `Le Rail Data Marketplace a demandé de ralentir : lectures en pause jusqu’à ${at} (heure britannique).`,
    ),
  storeUnreadable: both(
    '/data cannot be read: the pauses and the refused key are kept in memory only.',
    '/data ne peut pas être lu : les pauses et la clé refusée sont gardées en mémoire seulement.',
  ),
  waiting: both('Connected, first read in progress…', 'Connecté, première lecture en cours…'),
  ok: (count, at) =>
    both(
      `Connected: ${count} board(s) read, last at ${at} (UK time).`,
      `Connecté : ${count} tableau(x) lu(s), dernier à ${at} (heure britannique).`,
    ),
  allFailed: both(
    'No board could be read: see the messages below.',
    'Aucun tableau n’a pu être lu : voir les messages ci-dessous.',
  ),
};

/** Why one board was not read. */
export const BOARD_ERRORS = {
  bad_request: both(
    'station code not found (check it on nationalrail.co.uk)',
    'code de gare inconnu (vérifiez-le sur nationalrail.co.uk)',
  ),
  server: both('the service answered with an error', 'le service a répondu par une erreur'),
  timeout: both('no answer in time', 'pas de réponse à temps'),
  network: both('the service could not be reached', 'le service est injoignable'),
  too_large: both('answer too large, not read', 'réponse trop grande, non lue'),
  unreadable: both('answer not understood', 'réponse incomprise'),
};

export const TEST = {
  noKey: STATUS.noKey,
  invalidKey: STATUS.invalidKey,
  noBoard: STATUS.noBoard,
  paused: STATUS.paused,
  refused: STATUS.refused,
  busy: both(
    'A read is already in progress: try again in a moment.',
    'Une lecture est déjà en cours : réessayez dans un instant.',
  ),
  ok: (station, count) =>
    both(
      `It works: ${station}, ${count} departure(s) in the next two hours.`,
      `Ça fonctionne : ${station}, ${count} départ(s) dans les deux prochaines heures.`,
    ),
  failed: (reason) => both(`The read failed: ${reason.en}.`, `La lecture a échoué : ${reason.fr}.`),
};

export const SCENE_ERRORS = {
  unknownBoard: 'This board is not watched by the integration any more.',
  noFresh: 'No fresh departures for this board (see the status of the integration).',
};
