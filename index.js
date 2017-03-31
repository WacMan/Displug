const Discord = require('discord.js');
const bot = new Discord.Client();
var PlugAPI = require('plugapi');


// PLEASE FILL THESE: TODO: Put these in a config file
bot.login('DISCORD_BOT_TOKEN');   // NEED_INFO: Your Discord bot user token, get yours here: https://discordapp.com/developers/applications/me
var apiKey = "API_KEY"; // NEED_INFO: Put a valid YouTube Data API key, get yours here: https://developers.google.com/youtube/v3/getting-started
var botPlug = new PlugAPI({email: 'email@email.com', password: 'password'});    // NEED_INFO: The email and password for plug.dj that the bot will use (create a new one for the bot, if you use your personal one you won't be able to login at the same time as the bot...)
const botPlugUserName = 'BOT_PLUG_USERNAME';    // NEED_INFO: The username of the bot on plug.dj
var plugRoom = 'PLUG_ROOM'; // NEED_INFO: Your plug.dj room, the part after https://plug.dj

// Other configs:
var commandPrefix = "+";
var songVerbose = 2;    // Verbosity when a new song is played (0 = say nothing, 1 = say song name, 2 = song name and youtube thumbnail)

const plugMaxPlaylistLength = 200;      // Plug.dj has a max playlist length of 200 songs
const discordMaxMessageLength = 2000;   // Discord has a max message length of 2000 characters

var currentChannel = undefined;     // Discord channel where the bot will broadcast plug.dj-related messages
var currentPlugData = undefined;    // Plug.dj data for the currently playing song. Also contains DJ info and last song played.
var firstSongID = 0;        // ID of the first song played. Used to place songs before it when building a playlist while listening to it.
var reconnecting = false;    // Flag to show if you should send a message once we've reconnected.

var request = require('superagent');
var YoutubeTrack = require('./lib/youtube-track.js');
var Util = require('./lib/util.js');

botPlug.connect(plugRoom);

function connectPlug() {
    botPlug.connect(plugRoom);
}

botPlug.on('roomJoin', function (room) {
    console.log("Joined " + room);
    if (reconnecting && currentChannel) {
        currentChannel.sendMessage("Reconnected and joined " + room);
        reconnecting = false;
    }
});

botPlug.on('advance', function (data) {
    //console.log(data);
    if (currentChannel && data && data.media) {
        var currentlyPlaying = "";
        if (data.currentDJ.username == botPlugUserName) {
            currentlyPlaying = "Playing: ";
            if (firstSongID == 0) {
                firstSongID = data.media.id;
            }
            bot.user.setGame(data.media.author + " - " + data.media.title);
            //console.log("Setting playing title.");
        }
        else {
            currentlyPlaying = data.currentDJ.username + " is playing: ";
            bot.user.setGame(data.currentDJ.username + ": " + data.media.author + " - " + data.media.title);
            //console.log("Setting status online.");
        }
        if (songVerbose > 0) {
            currentlyPlaying += "**" + data.media.author + " - " + data.media.title + "** (" + Util.formatTime(data.media.duration) + ")";
            if (songVerbose == 2) {
                currentlyPlaying += "\n" + data.media.image;
            }
            currentChannel.sendMessage(currentlyPlaying);
        }
    }
    else {
        bot.user.setGame(null);
        //console.log("Setting status online.");
    }

    currentPlugData = data;
});

botPlug.on('userLeave', function (data) {
    //console.log(data);
    // Check if we're all alone
    var roomMeta = botPlug.getRoomMeta();
    //console.log("Room meta: \n", roomMeta);
    if (roomMeta.population <= 1 && currentPlugData.currentDJ != undefined && currentPlugData.currentDJ.username == botPlugUserName) {
        currentChannel.sendMessage("All alone in the plug.dj room... Stopping music.");
        botPlug.leaveBooth();
    }
});

var commands = [
    {
        command: ["music", "room"],
        description: "Gives the link to plug.dj.",
        parameters: [],
        execute: function (message, params) {
            message.channel.sendMessage('Join me on plug.dj at https://plug.dj/' + plugRoom + '.  Type ' + commandPrefix + 'help for a list of commands.');
        }
    },

    {
        command: ["createplaylist","cp"],
        description: "Creates a playlist with the specified name.",
        parameters: ["playlist name"],
        execute: function (message, params) {
            var string = buildString(params, " ");

            botPlug.createPlaylist(string, (err, data) => {
                if (err) {
                    console.log(err);
                    message.channel.sendMessage('Error creating playlist.');
                }
                else {
                    message.channel.sendMessage('Playlist **' + string + '** created.');
                }
            });
        }
    },

    {
        command: ["activateplaylist","ap"],
        description: "Activates specified playlist.",
        parameters: ["playlist name"],
        execute: function (message, params) {
            var string = buildString(params, " ");

            botPlug.getPlaylists((playlists) => {
                console.log('Num playlists: ' + playlists.length);
                for (var i = 0; i < playlists.length; i++) {
                    if (playlists[i].name.toLowerCase() == string.toLowerCase()) {
                        botPlug.activatePlaylist(playlists[i].id, (err, data) => {
                            if (err) {
                                console.log(err);
                                message.channel.sendMessage('Error activating playlist.');
                            }
                            else {
                                message.channel.sendMessage('Playlist **' + playlists[i].name + '** activated.');
                            }
                        });
                        break;
                    }
                }
            });
        }
    },

    {
        command: ["showplaylists","sp"],
        description: "Displays a list of available playlists.",
        parameters: [],
        execute: function (message, params) {
            botPlug.getPlaylists((playlists) => {
                var response = "Available playlists:";
                console.log('Num playlists: ' + playlists.length);
                for (var i = 0; i < playlists.length; i++) {
                    console.log(playlists[i].name);
                    response += "\n**" + playlists[i].name + "** (" + playlists[i].count + " songs)";
                    if (playlists[i].active) {
                        response += " **(Active)**";
                    }
                }
                message.channel.sendMessage(response);
            });
        }
    },

    {
        command: ["movetoplaylist","mtp","move"],
        description: "Moves current song to specified playlist.",
        parameters: ["target playlist"],
        execute: function (message, params) {
            if (currentPlugData.media == undefined) {
                message.channel.sendMessage("I'm not currently playing anything.");
                return;
            }
            var string = buildString(params, " ");
            // Find playlist using provided string
            botPlug.getPlaylists((playlists) => {
                var success = false;
                for (var i = 0; i < playlists.length; i++) {
                    if (playlists[i].name.toLowerCase() == string.toLowerCase()) {
                        success = true;
                        console.log('Found target playlist: ' + playlists[i].name);
                        // Get active playlist
                        botPlug.getActivePlaylist((playlist) => {
                            if (playlist == undefined) {
                                message.channel.sendMessage("No active playlist.");
                                return;
                            }
                            console.log('Found active playlist: ' + playlist.name);
                            // Make sure they're different
                            if (playlist.id == playlists[i].id) {
                                message.channel.sendMessage("Target playlist is the same as active playlist.");
                                return;
                            }
                            if (playlists[i].count >= plugMaxPlaylistLength) {
                                message.channel.sendMessage("Target playlist **" + playlists[i].name + "** is full.");
                            }
                            // Add video to specified playlist
                            botPlug.addSongToPlaylist(playlists[i].id, [currentPlugData.media], (err, data) => {
                                if (err) {
                                    message.channel.sendMessage('Couldn\'t add song, unexpected error.');
                                    console.log(err);
                                    return;
                                }
                                else {
                                    deleteSongFromActivePlaylist(message, []);
                                }
                            });
                        });
                        break;
                    }
                }
                if (!success)
                    message.channel.sendMessage("Unable to find playlist named **" + string + "**.");
            });
        }
    },

    {
        command: ["deleteplaylist","dp"],
        description: "Deletes specified playlist.",
        parameters: ["playlist name"],
        execute: function (message, params) {
            var string = buildString(params, " ");
            botPlug.getPlaylists((playlists) => {
                var found = false;
                for (var i = 0; i < playlists.length; i++) {
                    if(playlists[i].name.toLowerCase() == string.toLowerCase()) {
                        var playlistName = playlists[i].name;
                        botPlug.deletePlaylist(playlists[i].id, (err, data) => {
                            if (err) {
                                console.log(err);
                                message.channel.sendMessage('Error deleting playlist.');
                            }
                            else {
                                message.channel.sendMessage("Playlist **" + playlistName + "** deleted.");
                            }
                        });
                        found = true;
                        break;
                    }
                }
                if(!found)
                    message.channel.sendMessage("Unable to find playlist named **" + string + "**.");
            });
        }
    },

    {
        command: ["showsongs", "songs"],
        description: "Displays all songs in the active playlist.",
        parameters: [],
        execute: function (message, params) {
            botPlug.getActivePlaylist((playlist) => {
                if (playlist) {
                    botPlug.getPlaylistMedias(playlist.id, (err, songs) => {
                        if (err) {
                            message.channel.sendMessage('Unexpected error.');
                            console.log(err);
                        }
                        else {
                            if (songs.length > 0) {
                                console.log('Playlist length: ' + songs.length);
                                var songsTxt = "Songs in playlist **" + playlist.name + "** (" + playlist.count + " songs):";
                                var txtLength = songsTxt.length;
                                for (var i = 0; i < songs.length; i++) {
                                    var txtToAdd = "\n**" + songs[i].author + " - " + songs[i].title + "** (" + Util.formatTime(songs[i].duration) + "), ID: " + songs[i].id;
                                    if (txtLength + txtToAdd.length >= discordMaxMessageLength) {
                                        message.channel.sendMessage(songsTxt);
                                        songsTxt = "Songs in playlist **" + playlist.name + "** (" + playlist.count + " songs) (**continued**):";
                                        txtLength = songsTxt.length;
                                    }
                                    songsTxt += txtToAdd;
                                    txtLength += txtToAdd.length;
                                }
                                message.channel.sendMessage(songsTxt);
                            }
                            else {
                                message.channel.sendMessage('Active playlist is empty.');
                            }
                        }
                    });
                }
                else {
                    message.channel.sendMessage('No active playlist.');
                }
            });
        }
    },

    {
        command: ["delete"],
        description: "Deletes the specified song (using ID) from the active playlist. Deletes current song if no ID is specified.",
        parameters: [],
        execute: function (message, params) {
            deleteSongFromActivePlaylist(message, params);
        }
    },

    {
        command: ["shuffle"],
        description: "Randomizes the songs in the active playlist.",
        parameters: [],
        execute: function (message, params) {
            botPlug.getActivePlaylist((playlist) => {
                if (playlist) {
                    botPlug.shufflePlaylist(playlist.id, (err, data) => {
                        if (err) {
                            message.channel.sendMessage("Unexpected error.");
                            console.log(err);
                        }
                        else {
                            message.channel.sendMessage("Playlist **" + playlist.name + "** shuffled.");
                        }
                    });
                }
                else {
                    message.channel.sendMessage('No active playlist.');
                }
            });
        }
    },

    {
        command: ["play"],
        description: "Starts playing the active playlist.",
        parameters: [],
        execute: function (message, params) {
            // Check if we're all alone
            var roomMeta = botPlug.getRoomMeta();
            //console.log("Room meta: \n", roomMeta);
            if (roomMeta.population <= 1) {
                currentChannel.sendMessage("All alone in the plug.dj room, not playing music for myself.");
                return;
            }
            botPlug.getActivePlaylist((playlist) => {
                if (playlist) {
                    console.log('Found active playlist: ' + playlist.name + ', # of tracks: ' + playlist.count);
                    if (playlist.count > 0) {
                        botPlug.joinBooth();
                        //message.channel.sendMessage('Starting music...');
                    }
                    else {
                        message.channel.sendMessage('Active playlist is empty.');
                    }
                }
                else {
                    message.channel.sendMessage('No active playlist.');
                }
            });
        }
    },

    {
        command: ["playnext"],
        description: "Moves a specified song to the top of the active playlist.",
        parameters: ["Song ID"],
        execute: function (message, params) {
            var songId = +params[0];
            if (isNaN(songId)) {
                message.channel.sendMessage("Invalid song ID.");
            }

            if (currentPlugData.media != undefined && currentPlugData.currentDJ.username == botPlugUserName && currentPlugData.media.id == songId) {
                message.channel.sendMessage("Song is currently playing.");
            }

            botPlug.getActivePlaylist((playlist) => {
                if (playlist) {
                    console.log('Found active playlist: ' + playlist.name + ', # of tracks: ' + playlist.count);
                    // Need to find id of the song we just added
                    botPlug.getPlaylistMedias(playlist.id, (err, songs) => {
                        if (err) {
                            console.log(err);
                            message.channel.sendMessage("");
                        }
                        else {
                            if (songs.length > 1) {
                                if (songs[0].id == songId || (currentPlugData.media != undefined && currentPlugData.currentDJ.username == botPlugUserName && songs[1].id == songId)) {
                                    message.channel.sendMessage("Song is already next in queue.");
                                    return;
                                }
                                var found = false;
                                for (var i = 0; i < songs.length; i++) {
                                    if (songId == songs[i].id) {
                                        found = true;
                                        break;
                                    }
                                }
                                if (found == false) {
                                    message.channel.sendMessage("Song not found in active playlist.");
                                    return;
                                }
                                var beforeId = songs[0].id;
                                if (currentPlugData.media != undefined && beforeId == currentPlugData.media.id)
                                    beforeId = songs[1].id;
                                //console.log("beforeID: " + beforeId);
                                //console.log("songID: " + songId);
                                //console.log("Playlist: \n", playlist);
                                botPlug.playlistMoveMedia(playlist.id, songId, beforeId, (err, data) => {
                                    if (err) {
                                        console.log(err);
                                        message.channel.sendMessage("Error trying to move the song in the playlist.");
                                    }
                                    else {
                                        message.channel.sendMessage("**" + songs[i].author + " - " + songs[i].title + "** was moved to the top of the playlist.");
                                    }
                                });
                            }
                        }
                    });
                }
                else {
                    message.channel.sendMessage('No active playlist.');
                }
            });
        }
    },

    {
        command: ["stop"],
        description: "Stops playing music.",
        parameters: [],
        execute: function (message, params) {
            botPlug.leaveBooth();
            message.channel.sendMessage("Music stopped.");
        }
    },

    {
        command: ["add"],
        description: "Searches YouTube for a video and adds it to the active playlist.",
        parameters: ["query"],
        execute: function (message, params) {
            addSongFromYouTube(message, params, 0);
        }
    },

    {
        command: ["addnext"],
        description: "Searches YouTube for a video and adds it to the active playlist as next song.",
        parameters: ["query"],
        execute: function (message, params) {
            addSongFromYouTube(message, params, 1);
        }
    },

    {
        command: ["woot"],
        description: "Woots!",
        parameters: [],
        execute: function (message, params) {
            if (currentPlugData.media == undefined) {
                message.channel.sendMessage("Nothing is currently playing.");
                return;
            }
            if (currentPlugData.currentDJ.username == botPlugUserName) {
                message.channel.sendMessage("I can't woot my own song.");
                return;
            }
            
            botPlug.woot((err, data) => {
                if (err) {
                    console.log(err);
                    message.channel.sendMessage("Unexpected error.");
                }
                else {
                    message.channel.sendMessage("Woot! :raised_hands:");
                }
            });
        }
    },

    {
        command: ["help"],
        description: "Displays available music commands.",
        parameters: [],
        execute: function (message, params) {
            displayCommands(message, params, commands);
        }
    },

    {
        command: ["skip"],
        description: "Skips current song.",
        parameters: [],
        execute: function (message, params) {
            botPlug.selfSkip();
        }
    },

    {
        command: ["listeners","who"],
        description: "Displays users currently in the plug.dj room.",
        parameters: [],
        execute: function (message, params) {
            const roomUsers = botPlug.getUsers();
            //console.log("Room users: \n", roomUsers);
            var msg = "List of users currently in the plug.dj room:";
            for (const user of roomUsers) {
                msg += "\n" + user.username;
            }
            message.channel.sendMessage(msg);
        }
    },
    
    {
        command: ["setverbose", "sv"],
        description: "Verbosity when playing a new song (0=Silent, 1=Song name, 2=Song name and thumbnail).",
        parameters: ["verbosity"],
        execute: function (message, params) {
            var verbosity = +params[0];
            if (isNaN(verbosity) || verbosity < 0 || verbosity > 2) {
                message.channel.sendMessage("Invalid parameter. Expecting a number between 0 and 2.");
                return;
            }
            songVerbose = verbosity;
            
            var def = "";
            switch(songVerbose) {
                case 0:
                    def = "Silent";
                    break;
                case 1:
                    def = "Song name";
                    break;
                case 2:
                    def = "Song name + thumbnail";
                    break;
            }
            message.channel.sendMessage("Song verbosity set to **" + songVerbose + "** (" + def + ").");
        }
    },

    {
        command: ["reconnect"],
        description: "Forces reconnect to plug.dj.",
        parameters: [],
        execute: function (message, params) {
            botPlug.close();
            message.channel.sendMessage("Reconnecting...");
            setTimeout(connectPlug, 1000);
        }
    },
];

// Use these misc commands to create custom commands and have fun with your friends on Discord, mostly for commands not related to plug.dj
// TODO: Maybe move this to a seperate file or something...
var miscCommands = [
    {
        command: ["helpmisc"],
        description: "Displays available misc commands.",
        parameters: [],
        execute: function (message, params) {
            displayCommands(message, params, miscCommands);
        }
    },
];

bot.on('message', (message) =>
{
    //console.log(message);
    if (message.content.startsWith(commandPrefix) && message.channel.type ==="text") {
        if (handleCommand(message, commands)) {
            currentChannel = message.channel;  // Bot will respond in this channel for plug.dj-related events
        }
        else {
            handleCommand(message, miscCommands); // For custom commands not related to plug.dj
        }
    }
});

function handleCommand(message, commandsList)
{
    var args = message.content.split(" ");
    var commandStr = args[0].replace(commandPrefix, '');
    args.splice(0, 1);
    console.log("Command " + commandStr + " received.");

    var command = undefined;
    for (var i = 0; i < commandsList.length && command == undefined; i++) {
        for (var j = 0; j < commandsList[i].command.length && command == undefined; j++) {
            if (commandsList[i].command[j] == commandStr.toLowerCase()) {
                command = commandsList[i];
                break;
            }
        }
    }

    if(command)
    {
        if (args.length < command.parameters.length) {
            message.channel.sendMessage("Insufficient parameters!");
        } else {
            command.execute(message, args);
        }
        return true;
    }
    return false;
}

function displayCommands(message, params, commandsList)
{
    // TODO: Support splitting the message if it goes over 2000 characters (like in the showsongs command)
    var allCommands = "Available commands:";
    for (var i = 0; i < commandsList.length; i++) {
        allCommands += "\n**" + commandPrefix + commandsList[i].command[0] + "**";
        if (commandsList[i].command.length > 1) {
            allCommands += " (";
            for (var j = 1; j < commandsList[i].command.length; j++) {
                if (j > 1)
                    allCommands += ", ";
                allCommands += commandPrefix + commandsList[i].command[j];
            }
            allCommands += ")";
        }
        allCommands += ": " + commandsList[i].description;
    }
    message.channel.sendMessage(allCommands);
    
    //console.log("Help message length: " + allCommands.length);
}

function addSongFromYouTube(message, params, next)
{
    //console.log(message.content);
    //console.log(params);
    //console.log(next);
    if (apiKey === null) {
        console.log("You need a YouTube API key in order to use the !search command. Please see https://github.com/agubelu/discord-music-bot#obtaining-a-youtube-api-key");
    }
    else {
        var q = buildString(params, "+");

        if (q.length == 0) {
            message.channel.sendMessage('You need to specify a search parameter.');
            return;
        }

        var requestUrl = 'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&&safeSearch=none&q=' + q + '&key=' + apiKey;

        request(requestUrl, (error, response) => {
            if (!error && response.statusCode == 200) {
                var body = response.body;
                if (body.items.length == 0) {
                    message.channel.sendMessage('Your query gave 0 results.');
                    return;
                }

                for (var item of body.items) {
                    var vid = item.id.videoId;
                    YoutubeTrack.getInfoFromVid(vid, message, (err, video) => {
                        if (err) handleYTError(err);
                        else {
                            botPlug.getActivePlaylist((playlist) => {
                                if (playlist) {
                                    //console.log('Found active playlist: ' + playlist.name + ', count: ' + playlist.count + ', ID: ' + playlist.id);
                                    //console.log('Author: ' + video.author + ', CID: ' + vid + ', Duration: ' + video.lengthSeconds + ', Title: ', video.title);
                                    //console.log(video.prettyPrint());
                                    if (playlist.count >= plugMaxPlaylistLength) {
                                        message.channel.sendMessage("Playlist **" + playlist.name + "** is full.");
                                        return;
                                    }
                                    var options = {
                                        author: video.author,
                                        cid: vid,
                                        duration: +video.lengthSeconds,
                                        format: 1,
                                        image: 'https://i.ytimg.com/vi/' + vid + '/default.jpg',
                                        title: video.title
                                    };
                                    //console.log('addSongToPlaylist options: \n', options);
                                    botPlug.addSongToPlaylist(playlist.id, [options], (err, data) => {
                                        if (data) {
                                            //console.log(data);
                                        }
                                        if (err) {
                                            message.channel.sendMessage('Couldn\'t add song, unexpected error.');
                                            console.log(err);
                                        }
                                        else {
                                            message.channel.sendMessage('**' + video.title + '** (' + Util.formatTime(options.duration) + ') added to active playlist **' + playlist.name + '**.\n' + 'https://i.ytimg.com/vi/' + vid + '/default.jpg');
                                            // Plug.dj placed the song as the next song... move it if needed.
                                            // We'll try to place it before the first song that was played this session.
                                            //console.log("next: " + next);
                                            if (next == 0) {
                                                // Need to find id of the song we just added
                                                botPlug.getPlaylistMedias(playlist.id, (err, songs) => {
                                                    if (err) {
                                                        console.log(err);
                                                    }
                                                    else {
                                                        if (songs.length > 0) {
                                                            var newSongId = songs[0].id;
                                                            var beforeId = -1;
                                                            if (currentPlugData.media != undefined && firstSongID != currentPlugData.media.id)
                                                                beforeId = firstSongID;
                                                            //console.log("beforeID: " + beforeId);
                                                            //console.log("newSongID: " + newSongId);
                                                            //console.log("Playlist: \n", playlist);
                                                            botPlug.playlistMoveMedia(playlist.id, newSongId, beforeId, (err, data) => {
                                                                if (err) {
                                                                    console.log(err);
                                                                    message.channel.sendMessage("Error trying to move the song in the playlist.");
                                                                }
                                                            });
                                                        }
                                                    }
                                                });
                                            }
                                        }
                                    });
                                }
                                else {
                                    message.channel.sendMessage('No active playlist.');
                                }
                            });
                        }
                    });
                    return;
                }

                message.channel.sendMessage('No video has been found!');
            }
            else {
                message.channel.sendMessage('There was an error searching.');
                return;
            }
        });
    }
}

function deleteSongFromActivePlaylist(message, params)
{
    if (currentPlugData) {
        //console.log(params);
        if (currentPlugData.media == undefined && params.length == 0) {
            message.channel.sendMessage("Nothing is currently playing.");
            return;
        }

        if (currentPlugData.currentDJ != undefined && currentPlugData.currentDJ.username != botPlugUserName && params.length == 0) {
            message.channel.sendMessage("I'm not currently the DJ.");
            return;
        }

        botPlug.getActivePlaylist((playlist) => {
            if (playlist) {
                var songID = +params[0]; // Optional parameter
                if (isNaN(songID)) {
                    // Skip the song first
                    songID = currentPlugData.media.id;
                    botPlug.selfSkip(() => {
                        //console.log(songID);
                        botPlug.removeSongFromPlaylist(playlist.id, songID, (err, data) => {
                            if (data) {
                                //console.log(data);
                            }
                            if (err) {
                                message.channel.sendMessage("Unexpected error.");
                                console.log(err);
                            }
                            else {
                                message.channel.sendMessage("Song ID " + songID + " deleted from playlist **" + playlist.name + "**.");
                            }
                        });
                    });
                }
                else {
                    //console.log(songID);
                    botPlug.removeSongFromPlaylist(playlist.id, songID, (err, data) => {
                        if (data) {
                            //console.log(data);
                        }
                        if (err) {
                            message.channel.sendMessage("Unexpected error.");
                            console.log(err);
                        }
                        else {
                            message.channel.sendMessage("Song ID " + songID + " deleted from playlist **" + playlist.name + "**.");
                        }
                    });
                }
            }
            else {
                message.channel.sendMessage('No active playlist.');
            }
        });
    }
    else {
        console.log('Couldn\'t find data for command delete.');
    }
}

function buildString(params, seperation)
{
    var string = params[0];

    for (var i = 1; i < params.length; i++) {
        string += seperation + params[i];
    }

    return string;
}

function handleYTError(err)
{
    if (err.toString().indexOf('Code 150') > -1) {
        // Video unavailable in country
        currentChannel.sendMessage('This video is unavailable in the country the bot is running in! Please try a different video.');
    } else if (err.message == 'Could not extract signature deciphering actions') {
        currentChannel.sendMessage('YouTube streams have changed their formats, please update `ytdl-core` to account for the change!');
    } else if (err.message == 'status code 404') {
        currentChannel.sendMessage('That video does not exist!');
    } else {
        currentChannel.sendMessage('An error occurred while getting video information! Please try a different video.');
    }

    console.log(err.toString());
}
