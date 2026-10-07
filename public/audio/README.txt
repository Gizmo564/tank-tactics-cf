YOUR MUSIC AND SOUND EFFECTS GO IN THIS FOLDER
==============================================

1. Copy your audio files into this folder (public/audio/). MP3, OGG, M4A or WAV all work in modern browsers.
   Only use audio you have the rights to use. This repo may be public.

2. List them in audio.json, for example:

   {
     "music": ["track1.mp3", "track2.mp3"],
     "sfx": {
       "move": "move.mp3",
       "shoot": "shoot.mp3",
       "hit": "hit.mp3",
       "kill": "kill.mp3",
       "heal": "heal.mp3",
       "heart": "heart-pickup.mp3",
       "victory": "victory.mp3"
     }
   }

   - "music": played in a shuffled-start loop (one track repeats; several play one after another).
   - "sfx" names you can use:
       move    - a tank drives
       shoot   - a shot is fired
       hit     - a tank is hit
       kill    - a tank is destroyed
       heal    - a tank repairs
       heart   - a heart pickup is collected
       victory - the game ends
     Any name you leave out keeps its built-in synthesized sound.

3. Deploy:  npx wrangler deploy    (then hard-refresh the page once)

Keep files small: sound effects under ~100 KB and music tracks a few MB each load much faster, especially on phones.
