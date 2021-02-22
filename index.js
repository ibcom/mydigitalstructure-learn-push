/*
	This is node app to push messages to users based on an automation rule set up using
	https://console.mydigitalstructrue.cloud > 

	https://www.npmjs.com/package/lambda-local:

	lambda-local -l index.js -t 9000 -e event-1234.json
	lambda-local -l index.js -t 9000 -e event-5678.json

	Also see learn.js for more example code using the mydigitalstructure node module.
*/

exports.handler = function (event, context, callback)
{
	var mydigitalstructure = require('mydigitalstructure')
	var _ = require('lodash')
	var moment = require('moment');

	mydigitalstructure.set(
	{
		scope: 'push',
		context: '_event',
		value: event
	});

	//Event: {"site": "2007"}

	mydigitalstructure.set(
	{
		scope: 'push',
		context: '_context',
		value: context
	});

	mydigitalstructure.set(
	{
		scope: '_callback',
		value: callback
	});

	var settings;

	if (event != undefined)
	{
		if (event.site != undefined)
		{
			settings = event.site;
			//ie use settings-[event.site].json
		}
		else
		{
			settings = event;
		}
	}

	mydigitalstructure._util.message(
	[
		'-',
		'EVENT-SETTINGS:',
		settings
	]);

	mydigitalstructure.init(main, settings)

	mydigitalstructure._util.message('Using mydigitalstructure module version ' + mydigitalstructure.VERSION);
	
	function main(err, data)
	{
		var settings = mydigitalstructure.get({scope: '_settings'});

		mydigitalstructure._util.message(
		[
			'-',
			'SETTINGS:',
			settings
		]);

		if (settings.push.namespace != undefined)
		{
			mydigitalstructure._util.message(
			[
				'-',
				'NAMESPACE:',
				settings.push.namespace
			]);

			var pushfactory = require('./pushfactory.' + settings.push.namespace + '.js');
		}
		
		pushfactory.init()

		mydigitalstructure.add(
		{
			name: 'push-get-recipients',
			code: function (param, response)
			{
				var settings = mydigitalstructure.get({scope: '_settings'});

				if (settings.push == undefined)
				{}
				else
				{
					mydigitalstructure.cloud.search(
					{
						object: 'messaging_automation_recipient',
						fields:
						[
							{name: 'role'},
							{name: 'user'}
						],
						filters:
						[
							{
								field: 'automationtext',
								comparison: 'EQUAL_TO',
								value: settings.push.automationName
							}
						],
						callback: 'push-get-recipients-response'
					});
				}
			}
		});

		mydigitalstructure.add(
		{
			name: 'push-get-recipients-response',
			code: function (param, response)
			{
				if (response.status == 'OK')
				{
					mydigitalstructure.set(
					{
						scope: 'push',
						context: 'recipients',
						value: response.data.rows
					});
				}

				mydigitalstructure.invoke('push-process-recipients');
			}
		});

		mydigitalstructure.add(
		{
			name: 'push-process-recipients',
			code: function (param, response)
			{
				var recipients = mydigitalstructure.get(
				{
					scope: 'push',
					context: 'recipients'
				});

				if (recipients == undefined)
				{}
				else
				{
					var users = [];
					var roles = [];

					_.each(recipients, function (recipient)
					{
						if (recipient.user != '')
						{
							users.push(recipient.user)
						}
						else
						{
							roles.push(recipient.role)
						}
					});

					mydigitalstructure.set(
					{
						scope: 'push',
						context: 'userIDs',
						value: users
					});

					if (roles.length == 0)
					{
						mydigitalstructure.invoke('push-process-recipients-get-users')
					}
					else
					{
						mydigitalstructure.cloud.search(
						{
							object: 'setup_user_role',
							fields:
							[
								{name: 'user'}
							],
							filters:
							[
								{
									field: 'role',
									comparison: 'IN_LIST',
									value: roles.join(',')
								}
							],
							rows: 999999,
							callback: 'push-process-recipients-process-roles'
						});
					}
				}
			}
		});

		mydigitalstructure.add(
		{
			name: 'push-process-recipients-process-roles',
			code: function (param, response)
			{
				var userIDs = mydigitalstructure.get(
				{
					scope: 'push',
					context: 'userIDs'
				});

				var roleUsers = _.map(response.data.rows, 'user');

				userIDs = _.concat(userIDs, roleUsers);

				mydigitalstructure.set(
				{
					scope: 'push',
					context: 'userIDs',
					value: userIDs
				});

				mydigitalstructure.invoke('push-process-recipients-get-users');
			}
		});

		mydigitalstructure.add(
		{
			name: 'push-process-recipients-get-users',
			code: function (param)
			{
				var userIDs = mydigitalstructure.get(
				{
					scope: 'push',
					context: 'userIDs'
				});

				mydigitalstructure.cloud.search(
				{
					object: 'setup_user',
					fields:
					[
						{name: 'username'},
						{name: 'user.contactperson.firstname'},
						{name: 'user.contactperson.surname'},
						{name: 'user.contactperson.email'},
						{name: 'user.contactperson.mobile'}
					],
					filters:
					[
						{
							field: 'id',
							comparison: 'IN_LIST',
							value: userIDs.join(',')
						}
					],
					rows: 999999,
					callback: 'push-process-recipients-get-users-response'
				});

			}
		});

		mydigitalstructure.add(
		{
			name: 'push-process-recipients-get-users-response',
			code: function (param, response)
			{
				if (response.status == 'OK')
				{
					var users = _.map(response.data.rows, function (row)
					{
						return {
							id: row['id'],
							username: row['username'],
							firstname: row['user.contactperson.firstname'],
							surname: row['user.contactperson.surname'],
							lastname: row['user.contactperson.surname'],
							email: row['user.contactperson.email'],
							mobile: row['user.contactperson.mobile'] }
					})

					mydigitalstructure.set(
					{
						scope: 'push',
						context: 'users',
						value: users
					});
				}

				mydigitalstructure._util.message(
				[
					'-',
					'Users',
					users
				]);

				mydigitalstructure.invoke('push-get-data');
			}
		});

		mydigitalstructure.add(
		[
			{
				name: 'push-send-messages',
				code: function (param)
				{
					var messages = mydigitalstructure.get(
					{
						scope: 'push',
						context: 'messages'
					});

					mydigitalstructure._util.message(
					[
						'-',
						'MESSAGES:',
						messages
					]);

					mydigitalstructure.set(
					{
						scope: 'push-send-messages',
						context: 'index',
						value: 0
					});

					mydigitalstructure.invoke('push-send-messages-process')
				}
			},
			{
				name: 'push-send-messages-process',
				code: function (param)
				{
					var messages = mydigitalstructure.get(
					{
						scope: 'push',
						context: 'messages'
					});

					var index = mydigitalstructure.get(
					{
						scope: 'push-send-messages',
						context: 'index'
					});

					if (index < messages.length)
					{
						var message = messages[index];

						mydigitalstructure.cloud.invoke(
						{
							method: 'messaging_email_send',
							data: message,
							callback: 'push-send-message-next'
						});
					}
					else
					{
						mydigitalstructure.invoke('push-send-messages-finalise');
					}
				}
			},
			{
				name: 'push-send-message-next',
				code: function (param, response)
				{
					if (response.status == 'ER')
					{
						mydigitalstructure.invoke('util-log',
						{
							data: JSON.stringify(response.error.errornotes),
							notes: '[Push] Send Error'
						});
					}

					var index = mydigitalstructure.get(
					{
						scope: 'push-send-messages',
						context: 'index'
					});

					mydigitalstructure.set(
					{
						scope: 'push-send-messages',
						context: 'index',
						value: index + 1
					});

					mydigitalstructure.invoke('push-send-messages-process');
				}
			}
		]);

		mydigitalstructure.add(
		{
			name: 'push-send-messages-finalise',
			code: function (param, response)
			{
				var messages = mydigitalstructure.get(
				{
					scope: 'push',
					context: 'messages'
				});

				var data = 
				{
					status: 'OK',
					emailsSent: messages.length
				}
				
				mydigitalstructure._util.message(data);
				mydigitalstructure.invoke('util-end', data)
			}
		});

		mydigitalstructure.add(
		{
			name: 'util-log',
			code: function (data)
			{
				mydigitalstructure.cloud.save(
				{
					object: 'core_debug_log',
					data: data
				});
			}
		});

		mydigitalstructure.add(
		{
			name: 'util-end',
			code: function (data, error)
			{
				var callback = mydigitalstructure.get(
				{
					scope: '_callback'
				});

				if (error == undefined) {error = null}

				if (callback != undefined)
				{
					callback(error, data);
				}
			}
		});

		/* PROCESS STARTS HERE! */
		
		mydigitalstructure.invoke('push-get-recipients');
	}
}