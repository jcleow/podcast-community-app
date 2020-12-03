import pg from 'pg';
import jsSHA from 'jssha';
import methodOverride from 'method-override';
import cookieParser from 'cookie-parser';
import express, { response } from 'express';
import multer from 'multer';

// Define upload multer
const upload = multer({ dest: 'uploads/' });

// Constant Variable of process.env
const SALT = process.env.MY_ENV_VAR;
// Set up Pooling with PostgresQL
const { Pool } = pg;
let poolConfig;
if (process.env.ENV === 'PRODUCTION') {
  poolConfig = {
    user: 'postgres',
    // set DB_PASSWORD as an environment variable for security.
    password: process.env.DB_PASSWORD,
    host: 'localhost',
    database: 'podcast',
    port: 5432,
  };
} else {
  poolConfig = {
    user: process.env.USER,
    host: 'localhost',
    database: 'podcast',
    port: 5432, // Postgres server always runs on this port
  };
}
// Create a new instance of Pool object
const pool = new Pool(poolConfig);

// Set up Express app;
const app = express();
const PORT = process.argv[2];
// Set view engine to ejs
app.set('view engine', 'ejs');
// To parse encoded incoming requests  with urlencoded payloads
app.use(express.urlencoded({ extended: false }));
// Middleware to allow static images/css files to be served
app.use(express.static('public'));
// Middleware to allow static images/css files to be served
app.use(express.static('uploads'));
// Middleware that allows POST methods to be overriden for PUT and DELETE requests
app.use(methodOverride('_method'));
// Middleware that allows request.cookies to be parsed
app.use(cookieParser());

// Getting the uploaded artwork files back into the expressjs app
app.use(express.static('uploads'));

// Function that converts supplied username into a hash (using a salt)
const convertUserIdToHash = (userId) => {
  const shaObj = new jsSHA('SHA-512', 'TEXT', { encoding: 'UTF8' });
  const unhashedCookieString = `${userId}-${SALT}`;
  shaObj.update(unhashedCookieString);
  const hashedCookieString = shaObj.getHash('HEX');
  return hashedCookieString;
};

// Middleware that checks if a user has been logged in and authenticates
// before granting access to a page for every request
app.use((req, res, next) => {
// set the default value
  req.middlewareLoggedIn = false;

  // check to see if user is logged in but yet to be authenticated
  if (req.cookies.loggedInUserId) {
    // get the hashed value that should be inside the cookie
    const hash = convertUserIdToHash(req.cookies.loggedInUserId);
    // Test the value of the cookie
    if (req.cookies.loggedInHash === hash) {
      req.middlewareLoggedIn = true;
      // Look for this user in the database
      const { loggedInUserId } = req.cookies;
      // Try to get the user
      pool.query(`SELECT id,username FROM users WHERE id = ${loggedInUserId}`, (error, result) => {
        if (error || result.rows.length < 1) {
          res.status(503).send('sorry an error occurred');
        }
        // set the user as a key in the req object so that it is accessible
        req.loggedInUserId = result.rows[0].id;
        req.loggedInUser = result.rows[0].username;
        next();
      });
      // make sure we don't get down to the next () below
      return;
    }
  }
  next();
});
app.get('/', (req, res) => {
  // Store all data to be rendered in ejs in data var
  const data = {};
  // Check if the form is submitted by the genre/subgenre selection or the user has already
  // decided to submit the full form
  const episodeToPlay = req.query.episode_id;

  pool
    .query('SELECT * FROM podcast_series')
    .then((result) => {
      data.series = result.rows;

      // Prepare next query for podcast
      const selectAllPodcastEpisodesQuery = {
        text: 'SELECT *,podcast_episodes.name AS name, podcast_series.artwork_filename AS album_artwork, podcast_episodes.artwork_filename AS episode_artwork, podcast_episodes.description AS episode_description FROM podcast_episodes INNER JOIN podcast_series ON podcast_episodes.podcast_series_id = podcast_series.id',
      };
      return pool.query(selectAllPodcastEpisodesQuery);
    })

    .then((result) => {
      // Pass all the data from sql query into result.rows;
      data.episodes = result.rows;
      data.episodeLinkToPlay = episodeToPlay;
    })
    // Specific case to check if user wants to view podcast series
    .then(() => {
    // Check if user wants to view the podcast series description
      if (req.query) {
        if (req.query.series_id) {
          return pool.query(`
          SELECT 
          podcast_episodes.id AS episode_id,
          podcast_episodes.name AS episode_name,
          podcast_episodes.description AS episode_description,
          podcast_episodes.artwork_filename AS episode_artwork,
          podcast_episodes.podcast_ext_url,
          podcast_series.id AS series_id,
          podcast_series.name AS series_name,
          podcast_series.description AS series_description,
          podcast_series.artwork_filename AS series_artwork
          FROM podcast_series 
          INNER JOIN podcast_episodes 
          ON podcast_series.id=podcast_episodes.podcast_series_id 
          WHERE podcast_series.id = ${req.query.series_id}`);
        }
      }
    })
    .then((result) => {
      if (result) {
        data.selectedSeries = result.rows;
        console.log(result.rows, 'query-result');
      }
    })
    .then(() => {
      // Pass all the data into result.rows;
      res.render('mainpage/main', data);
    })
    .catch((error) => console.log(error));
});

// Route that renders a new form to enter podcast_series details
app.get('/podcast/create', (req, res) => {
  // first, store all the variables inside a data var
  const data = {};

  // Next check if there are data stored in cookies
  // If yes, pass them in to data var to be rendered via ejs
  if (req.cookies.previousValues) {
    data.previousValues = req.cookies.previousValues;
    if (req.cookies.previousFileSelected) {
      data.previousFileSelected = req.cookies.previousFileSelected;
    }
  }

  pool
    .query('SELECT id,name FROM genres')
    // second, check from cookies if there are any genres/subGenres names selected
    .then((result) => { data.genreNames = result.rows.map((row) => row.name);
    // third query for all the genres and subgenres and store into a temp data var
    })
    // fourth query to check if the podcastSeriesName already exists
    .then(() => {
      if (data.previousValues) {
        console.log(data.previousValues, 'previousValues');
        return pool.query(`SELECT name FROM podcast_series WHERE name='${data.previousValues.podcastSeriesName}'`);
      }
    })
    .then((result) => {
      console.log(result, 'result-1');
      if (result) {
        if (result.rows.length > 0) {
          data.isNameValid = 'false';
        } if (result.rows.length === 0) {
          data.isNameValid = 'true';
        }
      }
    })
    .then(() => {
      if (req.cookies.previousValues) {
        if (req.cookies.previousValues.genreName) {
          return pool.query(`SELECT subgenres.name FROM subgenres INNER JOIN genres ON genres.id = genre_id WHERE genres.name ='${req.cookies.previousValues.genreName}'`);
        } if (req.cookies.previousValues.genreText) {
          return pool.query(`SELECT subgenres.name FROM subgenres INNER JOIN genres ON genres.id = genre_id WHERE genres.name ='${req.cookies.previousValues.genreText}'`);
        }
      }
    })
    .then((result) => {
      if (result) {
        data.subgenreNames = result.rows.map((row) => row.name);
      }
      res.render('navlinks/createPodcastSeries', data);
    })
    .catch((error) => console.log(error));
});

// Route that creates a new podcast_series entry
app.post('/podcast/create', upload.single('artwork'), (req, res) => {
  // Check if entry is finished through temp data in req.cookies
  // if entry is not finished, the info will be stored in the cookies
  if (!req.body.submitOverallForm) {
    res.cookie('previousValues', req.body);
    res.cookie('previousFileSelected', req.file);
    res.redirect('/podcast/create');
    return;
  }

  // Insert new podcast details into podcast_series body
  const { podcastSeriesName, description } = req.body;
  const insertNewPodcastDetailsQuery = {
    text: 'INSERT INTO podcast_series(name,description) VALUES ($1,$2) RETURNING id AS podcast_series_id',
    values: [podcastSeriesName, description],
  };
  // Store current podcast_series_id
  let currPodcastSeriesId;

  // Execute all queries
  pool
    .query(insertNewPodcastDetailsQuery)
    .then((result) => {
      currPodcastSeriesId = result.rows[0].podcast_series_id;
      // Insert relationship between podcast and subgenre into podcast_series_subgenres join table
      const insertPodcastSubgenreQuery = {
        text: `INSERT INTO podcast_series_subgenres(podcast_series_id,subgenre_id) SELECT ${currPodcastSeriesId},subgenres.id FROM subgenres WHERE subgenres.name = '${req.body.subgenreText}'`,
      };

      return pool.query(insertPodcastSubgenreQuery);
    })
    // If user uploaded an artwork, then run the query to insert it
    .then(() => {
      if (req.file) {
        const { filename } = req.file;
        const insertPodcastSeriesArtworkQuery = {
          text: `UPDATE podcast_series SET artwork_filename= $1 WHERE id=${currPodcastSeriesId} RETURNING *`,
          values: [filename],
        };

        return pool.query(insertPodcastSeriesArtworkQuery);
      }
    })
    .then(() => {
      // If not, terminate the req-res cycle and clear cookies relating to create podcast form
      res.clearCookie('previousValues');
      res.clearCookie('previousFileSelected');
      res.redirect('/');
    })
    .catch((error) => response.status(503).send(error));
});

// Route that renders a form that creates a new podcast_episode
app.get('/podcast/episode/create', (req, res) => {
  // Store all results into a temp object to pass into ejs
  const data = {};

  if (req.cookies.previousValues) {
    data.previousValues = req.cookies.previousValues;
  }

  const selectAllExistingPodcastsQuery = {
    text: 'SELECT name FROM podcast_series',
  };

  pool
    // first obtain all the names of existing podcasts in the database
    .query(selectAllExistingPodcastsQuery)
    // consolidate the names into an array and assign to var data
    .then((result) => {
      const allExistingSeries = result.rows.map((row) => row.name);
      data.allExistingSeries = allExistingSeries;
      res.render('navlinks/uploadEpisode', data);
    })
    .catch((error) => console.log(error));
});

// Route that submits a request that creates a new podcast_episode entry
app.post('/podcast/episode/create', upload.single('artwork'), (req, res) => {
  // Check if entry is finished through temp data in req.cookies
  // if entry is not finished, the info will be stored in the cookies
  if (!req.body.submitOverallForm) {
    res.cookie('previousValues', req.body);
    res.redirect('/podcast/episode/create');
    return;
  }
  // Track the podcastEpisodeId being inserted
  let currPodcastEpisodeId;
  // Get the iframes soundCloudUrl out first
  const { soundCloudUrl: rawIframeUrl } = req.body;
  console.log(req.body, 'req-bpdy');

  // searching for the first string that starts with https and ends with true
  // \b stands for word boundary
  // .+? (one or more of any characters except linefeeds, non-greedily)
  const regex = new RegExp(/\bhttps.+?show_teaser=true\b/);
  const refinedUrl = rawIframeUrl.match(regex)[0];

  // Assign refinedurl to the request body
  req.body.soundCloudUrl = refinedUrl;

  // Store all the entries from req.body into values array
  const valuesArray = Object.entries(req.body).map(([key, value]) => value);
  const [podcastSeriesName, podcastEpisodeName, episodeNumber, description, externalLink, artwork] = valuesArray;

  const insertEpisodeQuery = {
    text: 'INSERT INTO podcast_episodes(name,episode_number,description,podcast_ext_url) VALUES($1,$2,$3,$4) RETURNING id',
    values: [podcastEpisodeName, Number(episodeNumber), description, externalLink],
  };

  // Execute all the queries
  pool
  // first insert the generic details of the new episodes
    .query(insertEpisodeQuery)
    .then((result) => {
      currPodcastEpisodeId = result.rows[0].id;
    })
    // next insert the filename of the uploaded artwork
    .then(() => {
      if (req.file) {
        const { filename } = req.file;
        const insertEpisodeArtworkQuery = {
          text: `UPDATE podcast_episodes SET artwork_filename = $1 WHERE id = ${currPodcastEpisodeId}`,
          values: [filename],
        };
        return pool.query(insertEpisodeArtworkQuery);
      }
    })
    // next select/get the serial id of the podcast series
    .then(() => {
      const selectPodcastSeriesId = `SELECT id FROM podcast_series WHERE name= '${podcastSeriesName}'`;
      return pool.query(selectPodcastSeriesId);
    })
    // next insert the podcast_series_id (Foreign key)
    .then((result) => {
      const insertPodcastSeriesIdForeignKeyQuery = (`UPDATE podcast_episodes SET podcast_series_id=${result.rows[0].id} WHERE podcast_episodes.id = ${currPodcastEpisodeId}`);
      return pool.query(insertPodcastSeriesIdForeignKeyQuery);
    })
    .then(() => {
      res.redirect('/');
    })
    .catch((error) => { console.log(error); });
});

// Route that displays the podcast series with its description and episodes
app.get('/series/:id', (req, res) => {
  pool.query('SELECT * ');
  res.render('podcastSeries', data);
});

app.listen(PORT);
