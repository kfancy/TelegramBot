var _       = require('underscore');
var request = require('request');
var promise = require('promise'); 

var TelegramBot = function( token ) {
  this.api_url           = 'https://api.telegram.org/bot' + token;
  this.command_character = '/';
  this.commands  = {};

  // Default Functions for logging the actions, override with your own functions
  this.functions = {
    onPlainText:       function( id, from, chat, date, message )  { console.log( "onPlainText", id, from, chat, date, message ); },
    onAudio:           function( id, from, chat, date, audio )    { console.log( "onAudio", audio ); },
    onDocument:        function( id, from, chat, date, document ) { console.log( "onDocument", document ); },
    onPhoto:           function( id, from, chat, date, photo )    { console.log( "onPhoto", photo ); },
    onSticker:         function( id, from, chat, date, sticker )  { console.log( "onSticker", sticker ); },
    onVideo:           function( id, from, chat, date, video )    { console.log( "onVideo", video ); },
    onContact:         function( id, from, chat, date, contact )  { console.log( "onContact", contact ); },
    onLocation:        function( id, from, chat, date, location ) { console.log( "onLocation", location ); },
    onNewParticipant:  function( id, from, chat, date, user )     { console.log( "onNewParticipant", user ); },
    onLeftParticipant: function( id, from, chat, date, user )     { console.log( "onLeftParticipant", user ); },
  };
  this.ready = false;
  this.bot_id = -1;
  this.bot_name = "uninitialized";

  this.lastUpdateId = 0;
  this.isPolling = false;
  this.pollMs = 0;
  this.command_cb = null; // callback to run whenever any successful command is found and ran
  this.command_notFound_cb = null; // callback to run whenever /action is called that is not found
  this.message_pre_cb = null; // callback to run whenever inbound message is found
  this.bot_ready_cb = null; // callback to run when bot is connected and ready

  this.debug = false;
  
  var self = this;
  this.getMe().then( function(body) { self.setReady(body) }, console.log );
}

/*
 * set debug on or off
 @param status BOOLEAN
 */
TelegramBot.prototype.setDebug = function( status ) {
	this.debug = !!(status); // allow truthy
}

/*
 * When created this bot does a 'getMe' to get details on the robot
 */
TelegramBot.prototype.setReady = function( body ) {
  if ( body.ok == true ) {
    this.bot_id   = body.result.id;
    this.bot_name = body.result.username;
    this.ready    = true;
    if (this.bot_ready_cb) {
    	this.bot_ready_cb();
    }
  }
}

/*
 * callback ran when bot is connected and ready
 */
TelegramBot.prototype.onReady = function( cb ) {
	if (typeof cb == 'function') {
		this.bot_ready_cb = cb;
		if (this.ready) {
			cb();
		}
	}
}

/*
 * callback ran when ANY message (command or otherwise) hits the bot.
 */
TelegramBot.prototype.onInboundMessage = function( cb ) {
	if (typeof cb == 'function') {
		this.message_pre_cb = cb;
	}
}

/*
 * callback ran when someone submits a /command
 */
TelegramBot.prototype.onCommandRun = function( cb ) {
	if (typeof cb == 'function') {
		this.command_cb = cb;
	}
}

/*
 * callback ran when someone submits a /command
 */
TelegramBot.prototype.onCommandNotFound = function( cb ) {
	if (typeof cb == 'function') {
		this.command_notFound_cb = cb;
	}
}


/*
 * https://core.telegram.org/bots/api#setwebhook
 * When the webhook is called, this function is called and proceeds with execution
 * if the updated message text contains a command.
 */
TelegramBot.prototype.onUpdate = function( message ) {
  var id   = message.message_id;
  var from = message.from;
  var date = message.date;
  var chat = message.chat;
  if ( this.ready == true ) {

  	// hook to pre-process (or otherwise track) an inbound message
  	if (this.message_pre_cb) {
  		this.message_pre_cb(message, function(err, _m) {
  			
  			if (err) {

				if (this.debug) {
					console.log('error pre-processing message!');
					console.log(err);
				}
				// something funny happened, just pass the original through.
				process_message.call(this, message);
  			
  			} else {
  			
				if (_m && _m.transcript_ts) {
					chat.transcript_ts = _m.transcript_ts;
					process_message.call(this, _m);
				} else {
					// something funny happened, just pass the original through.
					process_message.call(this, message);
				}
			}
			
  		}.bind(this));

  	} else {
  		process_message(message);
  	}
  	
  	function process_message(message) {

		if ( this.isChat(message) && this.isCommand(message) ) {
		  this.onCommand( id, from, chat, date, this.parseArguments(message.text) );
		}
		else {
		  if ( this.isChat(message) ) {
			this.functions.onPlainText( id, from, chat, date, message.text );
		  }
		  else if ( message.audio != undefined ) {
			this.functions.onAudio( id, from, chat, date, message.audio );
		  }
		  else if ( message.document != undefined ) {
			this.functions.onDocument( id, from, chat, date, message.document );
		  }
		  else if ( message.photo != undefined ) {
			this.functions.onPhoto( id, from, chat, date, message.photo );
		  }
		  else if ( message.sticker != undefined ) {
			this.functions.onSticker( id, from, chat, date, message.sticker );
		  }
		  else if ( message.video != undefined ) {
			this.functions.onVideo( id, from, chat, date, message.video );
		  }
		  else if ( message.contact != undefined ) {
			this.functions.onContact( id, from, chat, date, message.contact );
		  }
		  else if ( message.location != undefined ) {
			this.functions.onLocation( id, from, chat, date, message.location );
		  }
		  else if ( message.new_chat_participant != undefined ) {
			this.functions.onNewParticipant( id, from, chat, date, message.new_chat_participant );
		  }
		  else if ( message.left_chat_participant != undefined ) {
			this.functions.onLeftParticipant( id, from, chat, date, message.left_chat_participant );
		  } 
		}
	}
  }
}

/*
 * Runs the specified command if registered. Name is excluding the / character. 
 */
TelegramBot.prototype.onCommand = function( id, from, chat, date, args ) {
	var run = this.commands[args[0]]
		, args_original = JSON.parse( JSON.stringify(args) )
		, args_spliced = args.splice( 1, args.length )
		;

	if ( run != undefined ) {
		run( id, from, chat, date, args_spliced );
		if (this.command_cb) {
			this.command_cb( id, from, chat, date, args_original.join(' ') );
		}
	} else {
		if (this.command_notFound_cb) {
			this.command_notFound_cb( id, from, chat, date, args_original.join(' ') );
		} else {
			this.sendMessage( chat.id, 'Sorry, that command was not found. Try /help.', false, id );
		}
	}
}

/*
 *

/*
 * Returns true if the first character of the message text is a '/'
 */
TelegramBot.prototype.isCommand = function( message ) {
  return message.text[0] === this.command_character;
}

/*
 * Returns true if the message is from a group or sent to the bot individually
 */
TelegramBot.prototype.isChat = function( message ) {
  return message.text != undefined;
}

/*
 * Split the string at spaces and return the arguments
 */
TelegramBot.prototype.parseArguments = function( text ) {
  var args_parsed = [];
  var args_split  = text.split(" ");
  _.each( args_split, function(arg, index) {
    if ( index == 0 ) 
      args_parsed.push( arg.substring(1, arg.length) );
    else 
      args_parsed.push( decodeURIComponent(arg) );
  });
  return args_parsed;
}

/*
 * Add a command to be executed when a user calls a command
 */
TelegramBot.prototype.addCommand = function( name, callback ) {
  if ( this.commands[name] != undefined ) return false;
  this.commands[name] = callback;
}

/*
 * Given a map where the key is the parameter and the value is the argument
 * Build up a URL for calling a service
 */
TelegramBot.prototype.buildURI = function( resource, params ) {
  var param_keys = params != undefined ? _.keys(params) : [];
  var uri_resource = this.api_url + '/' + resource;
  var uri_params = "";
  _.each( param_keys, function(key, index) {
    var uri_param = key + '=' + encodeURIComponent( params[key] );
    if ( index != param_keys.length - 1 ) 
      uri_param += "&";
    uri_params += uri_param;
  });
  if ( uri_params.length != 0 ) {
    uri_resource += "?" + uri_params
  }
  return uri_resource;
}

/*
 * Send a HTTPS request and return a promise
 */
TelegramBot.prototype.httpsRequest = function( url ) {
  return new promise( function(fulfill, reject) {
    request( url, function( error, response, body ) {
      if(error) {
      	if (this.debug) {
			console.log('[ERROR IN BOT SEND]');
			console.log(error);
		}
      	reject(error)
      } else {
      	if (this.debug) {
			console.log('[BOT SEND is ok -- response]');
			console.log(body);
		}
      	fulfill(JSON.parse(body));
      }
    }.bind(this));
  });
}

/*
 * https://core.telegram.org/bots/api#setwebhook
 * Use this method to specify a url and receive incoming updates via an outgoing webhook.
 */
TelegramBot.prototype.setWebhook = function( url ) {
	this.isPolling = false;
	var url = this.buildURI( 'setWebhook', { url: url } );
	return this.httpsRequest(url);
}

/*
 * https://core.telegram.org/bots/api#getUpdates
 * Use this method to specify a url and receive incoming updates via polling
 */
TelegramBot.prototype.startPolling = function( interval_ms ) {
	interval_ms = interval_ms || 1000; // default: every second
	this.setWebhook('');
	this.pollMs = interval_ms;
	this.isPolling = true;
  this.poll();
}

/*
 * https://core.telegram.org/bots/api#getUpdates
 * Stop the polling....
 */
TelegramBot.prototype.stopPolling = function() {
	this.pollInterval = 0;
	this.isPolling = false;
	if (this.pollInterval) { clearTimeout(this.pollInterval); }
}

/*
 * https://core.telegram.org/bots/api#getUpdates
 * Stop the polling....
 */
TelegramBot.prototype.poll = function() {
	if (!this.isPolling) {
		//console.log('well, we tried to poll, but isPolling is false.');
		return false;
	}
	/*this.pollInterval = */setTimeout(function() {
		var url = this.buildURI('getUpdates', { offset: this.lastUpdateId });
		
		request( url, function( error, response, body ) {
			
			if (error) {
				
				console.error('ERROR!!! '+error);
				
			} else {
				
				try {
					var payload = typeof body == 'string' ? JSON.parse(body) : body;
				} catch (e) {
					var payload = false;
				}

				if (payload && payload.ok && payload.result && payload.result.length) {

					this.lastUpdateId = payload.result[ payload.result.length - 1 ].update_id + 1;
					//console.log('just set lastUpdateId to: '+this.lastUpdateId);

					payload.result.forEach(function(item) {
						if (this.debug) {
							console.log('MESSAGE ---------------------------------------------');
							console.dir(item);
						}
						this.onUpdate(item.message);
					}.bind(this));
				/*} else {
					if (this.debug) {
						console.error('payload was not ok, check raw body:');
						console.error(body);
					}*/
				}
				
			}

			// keep polling: (maybe do this with setInterval instead...)
			this.poll();

		}.bind(this));

	}.bind(this), this.pollMs);
}

/*
 * https://core.telegram.org/bots/api#getme
 * A simple method for testing your bot's auth token. 
 */
TelegramBot.prototype.getMe = function() {
  var url = this.buildURI( 'getMe' );
  return this.httpsRequest(url);
}

/*
 * https://core.telegram.org/bots/api#sendmessage
 * Use this method to send text messages. On success, the sent Message is returned. 
 */
TelegramBot.prototype.sendMessage = function( chat_id, text, disable_web_page_preview, reply_to_message_id, reply_markup ) {
  var params = { chat_id: chat_id, text: text };
  if ( disable_web_page_preview != undefined ) 
    params.disable_web_page_preview = disable_web_page_preview;
  if ( reply_to_message_id != undefined ) 
    params.reply_to_message_id = reply_to_message_id;
  if ( reply_markup != undefined ) 
    params.reply_markup = reply_markup;
    var URL = this.buildURI( 'sendMessage', params )
    if (this.debug) {
	    console.log('[ TelegramBot.prototype.sendMessage ] URL: '+URL);
	}
  return this.httpsRequest( URL );
}

/*
 * https://core.telegram.org/bots/api#forwardmessage
 * Use this method to forward messages of any kind. On success, the sent Message is returned.
 */
TelegramBot.prototype.forwardMessage = function( chat_id, from_chat_id, message_id ) {
  var params = { chat_id: chat_id, from_chat_id: from_chat_id, message_id: message_id };
  return this.httpsRequest( this.buildURI( 'forwardMessage', params ) );
}

/*
 * https://core.telegram.org/bots/api#sendphoto
 * Use this method to send photos. On success, the sent Message is returned.
 */
TelegramBot.prototype.sendPhoto = function( chat_id, photo, caption, reply_to_message_id, reply_markup ) {
  var params = { chat_id: chat_id, photo: photo };
  if ( caption != undefined ) 
    params.caption = caption;
  if ( reply_to_message_id != undefined ) 
    params.reply_to_message_id = reply_to_message_id;
  if ( reply_markup != undefined ) 
    params.reply_markup = reply_markup;
  return this.httpsRequest( this.buildURI( 'sendPhoto', params ) ); 
}

/*
 * https://core.telegram.org/bots/api#sendsticker
 * Use this method to send .webp stickers.
 */
TelegramBot.prototype.sendSticker = function( chat_id, sticker, reply_to_message_id, reply_markup ) {
  var params = { chat_id: chat_id, sticker: sticker };
  if ( reply_to_message_id != undefined ) 
    params.reply_to_message_id = reply_to_message_id;
  if ( reply_markup != undefined ) 
    params.reply_markup = reply_markup;
  return this.httpsRequest( this.buildURI( 'sendSticker', params ) );
}

/*
 * https://core.telegram.org/bots/api#sendaudio
 * Use this method to send audio files, if you want Telegram clients to display the file as a playable voice message. For this to work, your audio must be in an .ogg file encoded with OPUS
 */
TelegramBot.prototype.sendAudio = function( chat_id, audio, reply_to_message_id, reply_markup ) {
  var params = { chat_id: chat_id, audio: audio };
  if ( reply_to_message_id != undefined ) 
    params.reply_to_message_id = reply_to_message_id;
  if ( reply_markup != undefined )
    params.reply_markup = reply_markup;
  return this.httpsRequest( this.buildURI( 'sendAudio', params ) );
}

/*
 * https://core.telegram.org/bots/api#senddocument
 * Use this method to send general files. On success, the sent Message is returned. Bots can currently send files of any type of up to 50 MB in size
 */
TelegramBot.prototype.sendDocument = function( chat_id, document, reply_to_message_id, reply_markup ) {
  var params = { chat_id: chat_id, document: document };
  if ( reply_to_message_id != undefined )
    params.reply_to_message_id = reply_to_message_id;
  if ( reply_markup != undefined )
    params.reply_markup = reply_markup;
  return this.httpsRequest( this.buildURI( 'sendDocument', params ) );
}

/*
 * https://core.telegram.org/bots/api#sendvideo
 * Use this method to send video files, Telegram clients support mp4 videos (other formats may be sent as Document).
 */
TelegramBot.prototype.sendVideo = function( chat_id, video, reply_to_message_id, reply_markup ) {
  var params = { chat_id: chat_id, video: video };
  if ( reply_to_message_id != undefined ) 
    params.reply_to_message_id = reply_to_message_id;
  if ( reply_markup != undefined )
    params.reply_markup = reply_markup;
  return this.httpsRequest( this.buildURI( 'sendVideo', params ) );
}

/*
 * https://core.telegram.org/bots/api#sendchataction
 * Use this method when you need to tell the user that something is happening on the bot's side.
 */
TelegramBot.prototype.sendChatAction = function( chat_id, action ) {
  var params = { chat_id: chat_id, action: action };
  return this.httpsRequest( this.buildURI( 'sendChatAction', params ) );
}

module.exports = TelegramBot;
