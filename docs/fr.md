# National Rail pour Gladys Assistant

Les départs des trains britanniques en direct dans Gladys : les prochains trains de vos gares, leur voie, leur
retard, les suppressions et les messages de perturbation de National Rail, depuis Darwin, le moteur officiel
d’information en temps réel des trains de Grande-Bretagne.

Intégration non officielle, sans lien avec National Rail, National Rail Enquiries ni le Rail Delivery Group.
Powered by National Rail Enquiries. **Jamais testé avec une vraie clé** : écrit d’après la documentation
officielle du service Live Departure Board (LDBWS) et de son schéma, et testé contre un service simulé.

## Ce qu’il faut

Une clé gratuite du **Rail Data Marketplace** (RDM), la plateforme où National Rail publie désormais Darwin
pour les développeurs :

1. Créez un compte sur [raildata.org.uk](https://raildata.org.uk/).
2. Trouvez le produit **Live Departure Board** (Darwin, gratuit) et abonnez-vous.
3. Ouvrez votre abonnement et copiez sa **consumer key**.

L’ancienne page d’inscription d’OpenLDBWS ne répond plus (vérifié le 10 novembre 2026) : ses jetons ne sont
pas utilisés par cette intégration.

## Configuration

| Champ              | Quoi taper                                                                                                                                                                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Clé (consumer key) | La consumer key de l’abonnement. Gardée par Gladys dans sa base, jamais réaffichée, envoyée seulement au Rail Data Marketplace.                                                                                                                                                                                    |
| Tableaux           | Codes de gare (trois lettres : PAD pour London Paddington, RDG pour Reading…, indiqués sur chaque page de gare de nationalrail.co.uk), séparés par des virgules. `RDG>PAD` : seulement les trains au départ de Reading qui desservent London Paddington. `:Mon nom` à la fin nomme l’appareil. 6 tableaux au plus. |
| Rafraîchissement   | Fréquence de lecture de chaque tableau, 120 s par défaut (60 à 3600).                                                                                                                                                                                                                                              |
| Trains par tableau | Nombre de prochains trains exposés en fonctionnalités (3 par défaut, 1 à 5).                                                                                                                                                                                                                                       |
| Langue des valeurs | Anglais ou français, pour les noms des fonctionnalités et les textes.                                                                                                                                                                                                                                              |
| Adresse de l’API   | À laisser telle quelle, sauf si le Rail Data Marketplace déplace le produit. Seule une adresse `https://…raildata.org.uk` est acceptée : la clé n’est envoyée nulle part ailleurs.                                                                                                                                 |

Exemple : `PAD, RDG>PAD:Train du travail`.

Enregistrez, puis ouvrez l’onglet **Découverte** et ajoutez les tableaux. Seuls les tableaux ajoutés comme
appareils sont lus d’eux-mêmes. Le bouton **Tester la connexion** lit le premier tableau (au plus une fois toutes les
30 s ; un tableau lu depuis moins d’un intervalle répond d’après cette lecture).

## Appareils

Un appareil par tableau, en lecture seule. Pour chacun des prochains trains qui circuleront, avec une heure
connue :

- **Prochain train**, **Train 2**… : minutes avant son départ (d’après son heure estimée). `999` veut dire
  aucun train dans les deux prochaines heures.
- **Détails du prochain train**… : `18:15 Reading · voie 4 · retard 5 min (prévu 18:20)`.

Et pour tout le tableau :

- **Tableau des départs** : tous les trains, supprimés et retardés compris :
  `18:15 Reading (+5) · 18:22 Oxford (à l’heure) · 18:30 Didcot (supprimé)`.
- **Messages de perturbation** : les messages National Rail de la gare, sans leur HTML.

Un train supprimé, ou un train que Darwin dit seulement « Delayed » sans heure, n’a pas de compte à rebours :
il est indiqué dans le texte du tableau, sans heure inventée. Les heures sont celles du Royaume-Uni (GMT en
hiver, BST en été), changements d’heure et minuit compris. Aucune fonctionnalité ne garde d’historique.

## Scènes

- **Train en retard** (déclencheur) : un train d’un tableau suivi a désormais au moins 5, 10, 15 ou
  30 minutes de retard. Une fois par train et par seuil (un train en retard de 12 min déclenche les seuils 5
  et 10 min, puis 15 s’il prend plus de retard). Variables : gare, destination, heure prévue et estimée,
  retard, voie, exploitant, motif.
- **Train supprimé** (déclencheur) : une fois par train, avec le motif quand Darwin le donne.
- **Lire les prochains trains** (action) : les prochains trains d’un tableau, relus si la dernière lecture date
  de plus d’un intervalle. Sorties : minutes avant le prochain et le suivant, destination, heures, retard,
  voie, détails, tableau des départs, nombre de trains. Sans train, les sorties d’un train sont vides.

Les événements déjà envoyés sont gardés dans `/data` : un redémarrage ne les renvoie pas. 60 événements par
minute au plus sont envoyés, les autres aux lectures suivantes.

## Lectures, pauses et erreurs

- Chaque tableau est lu une fois par intervalle, une requête à la fois. L’heure de chaque tentative est écrite
  dans `/data` avant la requête (quand `/data` est inscriptible) : un redémarrage, une reconnexion, un formulaire enregistré ou l’onglet
  Découverte ne lisent jamais plus tôt.
- **Clé refusée** (401 ou 403 avec l’erreur de la passerelle du Rail Data Marketplace) : aucun nouvel essai
  automatique. Le statut le dit ; enregistrer une autre clé, ou un appui réussi sur **Tester la connexion**,
  lève le refus (une clé changée pendant que l’intégration était arrêtée partage l’étiquette de la clé
  refusée une fois sur 256 : le bouton lève alors le refus). Seule une étiquette de 8 bits d’une empreinte salée est gardée dans `/data`, jamais la clé.
  Un 401/403 illisible n’est pas pris pour un refus.
- **429 (trop de requêtes)** : tous les tableaux attendent, `Retry-After` s’il est donné, sinon 1 min
  doublée à chaque fois, entre 1 min et 6 h ; la pause est gardée dans `/data`.
- **Un tableau en échec** (erreur du serveur, pas de réponse en 10 s, code de gare inconnu) : il est relu de
  plus en plus tard (l’intervalle doublé, jusqu’à 1 h) ; les autres tableaux continuent.
- Les réponses de plus de 1 Mo sont coupées avant d’être lues, et un tableau produit plus de 15 min avant
  d’être servi n’est pas utilisé.
- `/data` illisible : jamais écrasé ; l’intégration le relit toutes les 10 s et, en 30 s au plus, continue
  avec les pauses et le refus en mémoire (le statut le dit).

## Vie privée

L’intégration envoie les codes de gare et votre clé au Rail Data Marketplace seulement, avec son propre
User-Agent (`gladys-national-rail/<version>`). Rien d’autre ne sort de votre Gladys.

## Données et licence

Données des trains : National Rail Enquiries (Darwin), par le Rail Data Marketplace, selon les conditions
acceptées à l’abonnement. Powered by National Rail Enquiries. Le code de l’intégration est sous Apache-2.0.
