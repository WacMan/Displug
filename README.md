# Displug
A discord bot to control music played on plug.dj.
# Install
This is my first shot at a Discord bot, a github repository and javascript so apologies for anything not going smoothly. Big thanks to the plugcubed community and their plugAPI! So here goes nothing:
- Make sure you have a valid app (bot) invited to your Discord server
- Make sure you install node.js version 6 or newer
- Download this repository to a local folder
- With a command line prompt, navigate to that folder and type **npm i**
- Open index.js with any text editor and fill in the required information in line 7 through 11.
  - 7: A valid Discord bot token, get yours here: https://discordapp.com/developers/applications/me
  - 8: A valid YouTube Data API key, get yours here: https://developers.google.com/youtube/v3/getting-started
  - 9: Plug.dj login credentials for your bot (email and password)
  - 10: Plug.dj username that you gave to your bot account
  - 11: The plug.dj room name that you want your bot to connect to.

Once this is all done, you should be able to start the bot by typing **node .** in the command prompt.
# Usage
By default, the prefix for the bot is +, so type +help to get started. Bot only responds to commands from Discord for now. No interaction from plug.dj.
