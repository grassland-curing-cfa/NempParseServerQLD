/*
 * Cloud code for "nemp-qld-dev" connected to the "nemp_dev_qld" MongoLab DB deployed on Heroku
 * Git repo:					https://github.com/grassland-curing-cfa/NempParseServerQLD
 * Initial checkin date:		21/07/2016
 * Following-up check date:		29/09/2016:	copied "main.js" from Parse hosted service
								04/10/2016:	modified "main.js" for preparation for migrating ParseServer to Heroku
								16/11/2016:	NEMP-1-150: added request.user to beforeSave and afterSave triggers for GCUR_OBSERVATION & GCUR_LOCATION classes
								01/12/2016:	NEMP-1-154: Running the "applyValidationByException" Cloud function creates incorrect String on the "SharedBy" column of the GCUR_OBSERVATION table
											NEMP-1-151: Remove unnecessary Parse.User.logIn(SUPERUSER, SUPERPASSWORD) and Parse.Cloud.useMasterKey() in the Cloud function
								06/07/2018: As per requested by Barry Heilbronn of QLD QFES, two changes were made to the report function:
											  1. additional fields "LocationStatus" & "DistrctName"  added to the observation report; also
											  2. list all mandatory locations including those with no observation or validation.
											  GAE VERSION AT 3-11
								11/07/2018: Created two cloud functions: "automateRunModel" & "automateFinaliseData" on the Parse Server for automating RunModel and FinaliseData jobs

 * 
 */
var _ = require('underscore');
var turf = require('turf');							// https://www.npmjs.com/package/turf

var SUPERUSER = process.env.SUPER_USER;
var SUPERPASSWORD = process.env.SUPER_USER_PASS;
var NULL_VAL_INT = -1;
var NULL_VAL_DBL = -1.0;

var APP_ID = process.env.APP_ID;
var MASTER_KEY = process.env.MASTER_KEY;
var SERVER_URL = process.env.SERVER_URL;

var MG_DOMAIN = process.env.MG_DOMAIN;
var MG_KEY = process.env.MG_KEY;
var CFA_NEMP_EMAIL = process.env.EMAIL_ADDR_CFA_NEMP;
var CFA_GL_EMAIL = process.env.EMAIL_ADDR_CFA_GL;
var EMAIL_LIST_WANT_TO_BECOME_OBSERVER = process.env.EMAIL_LIST_WANT_TO_BECOME_OBSERVER;
var _IS_DAYLIGHT_SAVING = (process.env.IS_DAYLIGHT_SAVING == "1" ? true : false);				// boolean indicates if it is now in Daylight Saving time
var _IS_FIRE_DANGER_PERIOD = (process.env.IS_FIRE_DANGER_PERIOD == "1" ? true : false);			// boolean indicates if it is now in the Fire Danger Period
var GAE_APP_URL = process.env.GAE_APP_URL;			// The URL to the GAE app (appspot)
var MAX_DAYS_ALLOWED_FOR_PREVIOUS_OBS = process.env.MAX_DAYS_ALLOWED_FOR_PREVIOUS_OBS;			// An obs with the FinalisedDate older than this number should not be returned and treated as Last Season data

var RESOLUTIONS = ["500", "6000"];
var SUPERUSER_OBJECTID = "Gy7V34YZwW";

//var SHARED_WITH_STATES = ["SA", "NSW"];

// Use Parse.Cloud.define to define as many cloud functions as you want.
// For example:
Parse.Cloud.define("hello", function(request, response) {
	response.success("Hello world from " + process.env.APP_NAME);
});

Parse.Cloud.define("getDateInAEST", function(request, response) {
	var currentDateInAEST = getTodayString(_IS_DAYLIGHT_SAVING);
	response.success("_IS_DAYLIGHT_SAVING is " + _IS_DAYLIGHT_SAVING + "; Current Date in AEST: '" + currentDateInAEST + "'");
});

Parse.Cloud.define("testMailgunJS", function(request, response) {
	var mailgun = require('mailgun-js')({apiKey: MG_KEY, domain: MG_DOMAIN});
	
	var data = {
		from: 'Excited User <me@samples.mailgun.org>',
		to: 'a.chen@cfa.vic.gov.au',
		bcc: 'tttchen2004@yahoo.com',
		subject: 'Hello from ' + process.env.SERVER_URL,
		text: '',
		html: 'Testing some Mailgun awesomness from <br><h1>' + process.env.SERVER_URL + '</h1>'
	};

	mailgun.messages().send(data, function (error, body) {
		if (error)
			response.error("" + error);    
		else
			response.success(body);
	});
});

// Parse.com Job for sending Request for Validation email
var validationRequestEmailHtml = '<!DOCTYPE html><html>' + 
			'<head>' + 
			'<title>Request For Validation</title>' + 
			'<style>' + 
			'p, li {margin:0cm; margin-bottom:.0001pt; font-size:11.0pt; font-family:"Calibri","sans-serif";}' + 
			'</style>' + 
			'</head>' + 
			'<body>' + 
			'<p>Good morning ' + process.env.VALIDATION_NOTIF_TO_PERSON + ',</p>' + 
			'<br>' + 
			'<p>Grassland curing data for Queensland is now ready for checking. To validate the ground observations, please log into ' + process.env.APP_NAME + ' ' + 
			'<a href="' + GAE_APP_URL + '">' + GAE_APP_URL + '</a>.</p>' + 
			'<br>' + 
			'<p>To use the system:</p>' + 
			'<br>' + 
			'<ul>' + 
			'<li>Log in with the username and password provided to you (Please make sure you use Internet Explorer 9 or above, Firefox or Google Chrome)</li>' + 
			'<li>Make sure you are in the system as a "Validator". You may need to select "Validator" from the drop-down list on the top right corner (if you have multiple roles assigned).</li>' + 
			'<li>Click "Validate Observations"</li>' + 
			'<li>Amend the curing value using the drop-down list for each location</li>' + 
			'<li>Click the "Back" button to return to the main page</li>' + 
			'<li>Log out</li>' + 
			'</ul>' + 
			'<br>' + 
			'<p>You can also access the "Help" button at the bottom of the main page.</p>' + 
			'<br>' + 
			'<p>If you have any questions, please contact us (Alex - 03 8822 8060; Rachel - 03 9262 8607).</p>' + 
			'<br>' + 
			'<p>Kind Regards,</p>' + 
			'<br>' + 
			'<p>The NEMP Grassland Curing Team</p>' + 
			'<br>' + 
			'<table><tr><td width="30%"><img src="http://www.cfa.vic.gov.au/img/logo.png" width="64" height="64" alt="CFA_LOGO" /></td>' + 
			'<td><p style="color:#C00000; font-weight: bold;">NEMP Grassland Curing Team</p><p>CFA HQ - Fire & Emergency Management - 8 Lakeside Drive, Burwood East, Victoria, 3151</p>' + 
			'<p>E: <a href="mailto:' + CFA_NEMP_EMAIL + '" target="_top">' + CFA_NEMP_EMAIL + '</a></p></td></tr></table>' + 
			'<br>' + 
			'<p><i>Note: This email has been generated automatically by ' + process.env.APP_NAME + '. Please do not reply to this email.</i></p>' + 
			'</body>' + 
			'</html>';
/*
		Mailgun.sendEmail({
			  to: toEmail,
			  cc: CFA_NEMP_EMAIL,
			  from: CFA_NEMP_EMAIL,
			  subject: "Queensland - Grassland Curing Validation Notification",
			  text: "",
			  html: html
			}, {
			  success: function(httpResponse) {
			    console.log(httpResponse);
			    status.success("Request for Validation email sent successfully.");
			  },
			  error: function(httpResponse) {
			    console.error(httpResponse);
			    status.error("Uh oh, something went wrong with sending Request for Validation email.");
			  }
		});
	} else {
		status.success("Job executed but Request for Validation email NOT sent due to invalid date and time.");
	}
});
*/

Parse.Cloud.define("sendEmailRequestForValidation", function(request, response) {
	console.log('Function [sendEmailRequestForValidation] being executed...');
	
	if (_IS_FIRE_DANGER_PERIOD) {
		var toEmails = process.env.VALIDATION_NOTIF_TO_EMAILS;

		var mailgun = require('mailgun-js')({apiKey: MG_KEY, domain: MG_DOMAIN});	
		
		var data = {
			to: toEmails,
			cc: CFA_NEMP_EMAIL,
			from: CFA_NEMP_EMAIL,
			subject: "Queensland - Grassland Curing Validation Notification",
			text: "",
			html: validationRequestEmailHtml
		};

		mailgun.messages().send(data, function (error, body) {
			if (error) {
				console.log(error);
				response.error("" + error);
			}
			else {
				console.log(body);
				response.success(body);
			}
		});
	} else
		response.success("_IS_FIRE_DANGER_PERIOD: " + _IS_FIRE_DANGER_PERIOD + "; No RequestForValidation email to be sent.");
});
	  
// Send a "Want to become an observer" email via Mailgun
Parse.Cloud.define("sendEmailWantToBecomeObserver", function(request, response) {
	var mailgun = require('mailgun-js')({apiKey: MG_KEY, domain: MG_DOMAIN});
	
	var firstname = request.params.fn;
	var lastname = request.params.ln;
	var email = request.params.em;
	var address = request.params.addr;
	var suburb = request.params.sub;
	var state = request.params.st;
	var postcode = request.params.pc;
	
	var html = '<!DOCTYPE html><html>' +
		'<body>' + 
		'Hello,' + 
		'<p>' + '<strong>' + firstname + ' ' +  lastname + '</strong> (<a href="mailto:' + email + '">' + email + '</a>) has signed up to become an observer. The following contact information has also been provided:</p>' + 
		'<ul>' + 
		'<li>Address:   ' + address + '</li>' + 
		'<li>Suburb:    ' + suburb + '</li>' + 
		'<li>State:     ' + state + '</li>' + 
		'<li>Postcode:  ' + postcode + '</li>' + 
		'</ul>' +
		'<p>Kind Regards,</p>' + 
		'<p>The NEMP Grassland Curing Team <a href="' + CFA_NEMP_EMAIL + '">' + CFA_NEMP_EMAIL + '</a></p>' + 
		'<p><i>Note: This email has been generated automatically by ' + process.env.APP_NAME + '. Please do not reply to this email.</i></p>' + 
		'</body>' + 
		'</html>';

	mailgun.messages().send({
		to: EMAIL_LIST_WANT_TO_BECOME_OBSERVER,
		from: CFA_NEMP_EMAIL,
		cc: CFA_NEMP_EMAIL,
		subject: "Express of Interest to become a grassland curing observer",
		text: '',
		html: html
	}, function (error, body) {
		if (error)
			response.error("" + error);    
		else
			response.success(body);
	});
});

//Send a "Welcome email to new user upon signed-up" via Mailgun
Parse.Cloud.define("sendEmailWelcomeNewUser", function(request, response) {
	var mailgun = require('mailgun-js')({apiKey: MG_KEY, domain: MG_DOMAIN});
	
	var firstname = request.params.fn;
	var lastname = request.params.ln;
	var username = request.params.un;
	var password = request.params.pw;
	var email = request.params.em;
	
	var html = '<!DOCTYPE html><html>' +
	'<head>' + 
	'<meta charset="UTF-8">' + 
	'<title>Welcome to the QLD Grassland Curing Trial</title>' + 
	'<style>' + 
	'p, li {margin:0cm; margin-bottom:.0001pt; font-size:11.0pt; font-family:"Calibri","sans-serif";}' + 
	'</style>' + 
	'</head>' + 
	'<body>' + 
	'<p>Hi ' + firstname + ',' + '</p>' + '<br>' + 
	'<p>Thank you for participating in the Queensland grassland curing trial, supported by the Predictive Services Unit and RFSQ and funded by the Commonwealth Attorney General&#39;s Department National Emergency Management Projects (NEMP).</p>' + '<br>' + 
	'<p>Currently in Victoria, grassland curing is monitored operationally using a combination of satellite data and field observations, which are reported weekly by observers using a web-based data entry tool. As a trial, we are deploying the Victorian approach for Queensland (as well as other states and territories). For online training videos, we encourage you to visit <a href="www.cfa.vic.gov.au/grass">www.cfa.vic.gov.au/grass</a>.</p>' + '<br>' + 
	'<p>The Queensland web-based data entry tool can be accessed via: <a href="' + GAE_APP_URL + '">' + GAE_APP_URL + '</a> (take note, the tool works best on Firefox, Chrome, Internet Explorer 9 or 10)</p>' + '<br>' + 
	'<p>Your login details are as follows: </p>' + '<br>' + 
	'<ul>' + 
	'<li>Username: ' + username + '</li>' + 
	'<li>Password: ' + password + '</li>' + 
	'</ul>' + '<br>' + 
	'<p>Once you have logged on, you can select &#34;Enter Observations&#34;, and click on your observation site. You can then enter your curing observation from the drop-down list as well as providing a height, cover and fuel load estimate. When you are finished, click &#34;Submit Observation&#34; at the bottom of the page.</p>' + '<br>' + 
	'<p>Observations can be entered anytime during the week up until <strong>Wednesday morning at 9am</strong>. On <strong>Wednesday afternoon</strong>, a trial curing map will be published and sent to all observers via email. We hope to continue this process on a weekly basis for the duration of the fire season.</p>' + '<br>' + 
	'<p>Once again, we thank you for your interest. Please contact the QFES Predictive Services Unit at <a href="mailto:psu@qfes.qld.gov.au">psu@qfes.qld.gov.au</a> if you have any questions. We look forward to hearing from you soon.</p>' + '<br>' + 
	'<p>Kind Regards,</p>' + 
	'<p>The NEMP Grassland Curing Team</p>' + 
	'<br>' + 
	'<table><tr><td width="30%"><img src="http://www.cfa.vic.gov.au/img/logo.png" width="64" height="64" alt="CFA_LOGO" /></td>' + 
	'<td><p style="color:#C00000; font-weight: bold;">NEMP Grassland Curing Team</p><p>CFA HQ - Fire & Emergency Management - 8 Lakeside Drive, Burwood East, Victoria, 3151</p>' + 
	'<p>E: <a href="mailto:' + CFA_NEMP_EMAIL + '" target="_top">' + CFA_NEMP_EMAIL + '</a></p></td></tr></table>' + 
	'<br>' + 
	'<p><i>Note: This email has been generated automatically by ' + process.env.APP_NAME + '. Please do not reply to this email.</i></p>' + 
	'</body>' + 
	'</html>';
	
	mailgun.messages().send({
		to: email,
		bcc: CFA_NEMP_EMAIL,
		from: CFA_NEMP_EMAIL,
		subject: "Welcome to the Queensland Grassland Curing Trial",
		text: "",
		html: html
	}, function (error, body) {
		if (error)
			response.error("" + error);    
		else
			response.success(body);
	});
})

//Send a "finalised map" email to all active observers, validators and administrators via Mailgun
Parse.Cloud.define("sendEmailFinalisedDataToUsers", function(request, response) {
	// get all active observers
	var recipientList = "";
	
	var queryMMR = new Parse.Query("GCUR_MMR_USER_ROLE");
	queryMMR.include("user");
	//queryMMR.include("role");
	queryMMR.limit(1000);
	queryMMR.find({ useMasterKey: true }).then(function(results) {
		// results is array of GCUR_MMR_USER_ROLE records
		for (var i = 0; i < results.length; i++) {
			//var role = results[i].get("role");
			var status = results[i].get("status");
			//if (status && (role.get("name") == "Observers")) {
			if (status) {	// only select active users
				var user = results[i].get("user");
				var email = user.get("email");
				recipientList = recipientList + email + ";";
			}
		}
		
		// use Mailgun to send email
		var mailgun = require('mailgun-js')({apiKey: MG_KEY, domain: MG_DOMAIN});
		
		var strToday = getTodayString(_IS_DAYLIGHT_SAVING);
		
		var html = '<!DOCTYPE html><html>' +
			'<body>' + 
			'Hello all,' + 
			'<p>The Queensland grassland curing and fuel load maps have been updated for the ' + strToday + '. To view the grassland curing map, please click <a href="' + GAE_APP_URL + '/viscaModel?action=grasslandCuringMap">here</a>. To view the fuel load maps, please click <a href="' + GAE_APP_URL + '/viscaModel?action=fuelLoadMaps">here</a>.</p>' + 
			'<p>Please note you can always enter your observations through the online data entry tool <a href="' + GAE_APP_URL + '">' + GAE_APP_URL + '</a>. If you cannot remember your log details, please let us know and we will send them to you.</p>' +
			'<p>Kind Regards,</p>' + 
			'<p>The NEMP Grassland Curing Team <a href="' + CFA_NEMP_EMAIL + '">' + CFA_NEMP_EMAIL + '</a></p>' + 
			'<p><i>Note: This email has been generated automatically by ' + process.env.APP_NAME + '. Please do not reply to this email.</i></p>' + 
			'</body>' + 
			'</html>';
		
		mailgun.messages().send({
			to: CFA_NEMP_EMAIL,
			//cc: "a.chen@cfa.vic.gov.au",
			bcc: recipientList + CFA_GL_EMAIL + ";",
			from: CFA_NEMP_EMAIL,
			subject: "Queensland Grassland Curing Map - " + strToday,
			text: "",
			html: html
        }, function (error, body) {
        	if (error)
        		response.error("" + error);    
        	else
        		response.success("Email sent. Details: " + JSON.stringify(body));
        });
		//response.success(emailList);	
	}, function(error) {
	    response.error("GCUR_MMR_USER_ROLE table lookup failed");
	});
});

//export a list of email addresses for all active users
Parse.Cloud.define("exportEmailsForActiveUsers", function(request, response) {
	var recipientList = "";
	
	var queryMMR = new Parse.Query("GCUR_MMR_USER_ROLE");
	queryMMR.include("user");
	queryMMR.include("role");
	queryMMR.limit(1000);
	queryMMR.find({ useMasterKey: true }).then(function(results) {
		// results is array of GCUR_MMR_USER_ROLE records
		for (var i = 0; i < results.length; i++) {
			var role = results[i].get("role");
			var status = results[i].get("status");
			if (status && ((role.get("name") == "Observers") || (role.get("name") == "Validators"))) {
			//if (status) {	// only select active users
				var user = results[i].get("user");
				var email = user.get("email");
				
				if (recipientList.indexOf(email) == -1) {
					console.log("Email [" + email + "] being added in recipientList.");
					recipientList = recipientList + email + ";";
				} else
					console.log("Email [" + email + "] already added in recipientList.");
			}
		}
		response.success(recipientList);	
	}, function(error) {
	    response.error("GCUR_MMR_USER_ROLE table lookup failed");
	});
});

//export a list of email addresses for recipients that receive the finalsed map email
Parse.Cloud.define("exportEmailsForManualFinalMapEmail", function(request, response) {
	var recipientList = CFA_GL_EMAIL + ";";
	
	var queryMMR = new Parse.Query("GCUR_MMR_USER_ROLE");
	queryMMR.include("user");
	queryMMR.include("role");
	queryMMR.limit(1000);
	queryMMR.find({ useMasterKey: true }).then(function(results) {
		// results is array of GCUR_MMR_USER_ROLE records
		for (var i = 0; i < results.length; i++) {
			var role = results[i].get("role");
			var status = results[i].get("status");
			//if (status && ((role.get("name") == "Observers") || (role.get("name") == "Validators"))) {
			if (status) {	// only select active users
				var user = results[i].get("user");
				var email = user.get("email");
				
				if (recipientList.indexOf(email) == -1) {
					console.log("Email [" + email + "] being added in recipientList.");
					recipientList = recipientList + email + ";";
				} else
					console.log("Email [" + email + "] already added in recipientList.");
			}
		}
		response.success(recipientList);	
	}, function(error) {
	    response.error("GCUR_MMR_USER_ROLE table lookup failed");
	});
});

// export a list of email addresses for all activated validators and admins
Parse.Cloud.define("exportAllValAdminEmails", function(request, response) {
	var recipientList = "";
	
	var queryMMR = new Parse.Query("GCUR_MMR_USER_ROLE");
	queryMMR.include("user");
	queryMMR.include("role");
	queryMMR.limit(1000);
	queryMMR.find({ useMasterKey: true }).then(function(results) {
		// results is array of GCUR_MMR_USER_ROLE records
		for (var i = 0; i < results.length; i++) {
			var role = results[i].get("role");
			var status = results[i].get("status");
			if (status && ((role.get("name") == "Administrators") || (role.get("name") == "Validators"))) {
			//if (status) {	// only select active users
				var user = results[i].get("user");
				var email = user.get("email");
				
				if (recipientList.indexOf(email) == -1) {
					console.log(role.get("name") + " - Email [" + email + "] being added in recipientList.");
					recipientList = recipientList + email + ";";
				} else
					console.log(role.get("name") + " - Email [" + email + "] already added in recipientList.");
			}
		}
		response.success(recipientList);	
	}, function(error) {
	    response.error("GCUR_MMR_USER_ROLE table lookup failed");
	});
});

Parse.Cloud.define("countOfObservations", function(request, response) {
  var query = new Parse.Query("GCUR_OBSERVATION");

  query.count({
    success: function(count) {
      // The count request succeeded. Show the count
      response.success(count);
    },
    error: function(error) {
      response.error("OBS lookup failed");
    }
  });
});

Parse.Cloud.define("isLocationNameExist", function(request, response) {
  var query = new Parse.Query("GCUR_LOCATION");
  query.equalTo("LocationName", request.params.locationName);
  query.limit(1000);
  query.find().then(function(results) {
    if (results.length > 0)
      response.success(results[0]);
    else
      response.success(new Object());
  }, function(error) {
    response.error("Location table lookup failed");
  });
});

Parse.Cloud.define("deleteUserByUsername", function(request, response) {
	var username = request.params.username;
	
	// Check if the username exists before it gets deleted
	var queryUser = new Parse.Query(Parse.User);
	queryUser.equalTo("username", username);
	queryUser.limit(1000);
	queryUser.find({ useMasterKey: true }).then(function(results) {
		console.log(results.length + " _USER found for username [" + username + "]. Ready to be destroyed by the function deleteUserByUsername!");
		return Parse.Object.destroyAll(results);
	}, function(error) {
		console.log("_USER table lookup failed");
	    response.success(false);
	}).then(function() {
		console.log('_USER record [' + username + '] successfully deleted.');
		response.success(true);
	}, function(error) {
		console.log('Failed to delete _USER record[' + username + '].');
		response.success(false);
	});
});

/*
Parse.Cloud.define("getRolesForUserObjectId", function(request, response) {
  var userObjectId = null;
  var roleName = null;
  var roleArray = [];

  // Log-in required dued to class-level security set on ROLE table
  Parse.User.logIn(SUPERUSER, SUPERPASSWORD).then(function(user) {
    var queryUser = new Parse.Query(Parse.User);
    queryUser.equalTo("objectId", request.params.objectId);
    return queryUser.first();
  }).then(function(usr) {
    if (usr != undefined) {
        // username has been found
		userObjectId = usr.id;
		var queryRole = new Parse.Query(Parse.Role);
		return queryRole.find();
    } else {
		// username not found and a Promise is thrown out
		return Parse.Promise.error("There was an error in finding the user.");
    }
  }).then(function(results) {
    //response.success(roles.length);
    // Create a trivial resolved promise as a base case.
    var promises = [];
    _.each(results, function(result) {
        // query for all Users that have been granted the each role
        var queryUsersInRole = result.getUsers().query();
        
        promises.push(queryUsersInRole.find(
        {
            success : function(usrs) {        	
                for(var j = 0; j < usrs.length; j ++) {
        		    if (userObjectId == usrs[j].id) {
        		    	roleArray.push(result);
        			    break;
        		    }
        	    }
            },
            error : function(error) {
                return Parse.Promise.error("There was an error in finding users in a Role.");
            }
        }));
    });
    // Return a new promise that is resolved when all of the deletes are finished.
    return Parse.Promise.when(promises);
  }).then(function() {
    // Every comment was deleted.
    response.success(roleArray);
  }, function(error) {
    response.error(error);
  });
});

Parse.Cloud.define("getMaxLocationId", function(request, response) {
  // Log-in required dued to ACL set on GCUR_LOCATION table with Roles and Users
  Parse.User.logIn(SUPERUSER, SUPERPASSWORD).then(function(user) {
    var query = new Parse.Query("GCUR_LOCATION");
    return query.find();
  }).then(function(results) {
    var max = 0;
    for (var i = 0; i < results.length; ++i) {
	   var id = parseInt(results[i].get("LocationId"));
        if (id > max) {
		max = id;
	  }
    }

    response.success(max);	
  }, function(error) {
    response.error("Location table lookup failed");
  });
});

Parse.Cloud.beforeSave("GCUR_LOCATION", function(request, response) {
  Parse.Cloud.run("getMaxLocationId", {}, {
    success: function(result) {
      // result is the max number of location id

	var query = new Parse.Query("GCUR_LOCATION");
	query.equalTo("objectId", request.object.id);
	query.find({
  		success: function(results) {
    		// The object was retrieved successfully.

  			// Only when a new location is created, LocationId is amended!!!
			if (results.length == 0) {
				request.object.set("LocationId", result + 1);
			}
			
      		response.success();
  		},
  		error: function(error) {
    		// The object was not retrieved successfully.
    		// error is a Parse.Error with an error code and message.
  			response.error("Table GCUR_LOCATION lookup execution failed");
  		}
	});
    },
    error: function(error) {
      response.error("Cloud function getMaxLocationId execution failed");
    }
  });
});
*/

/**
 * Populate all ShareBy{STATE} columns available by "True" beforeSave a new Observation is added
 */
Parse.Cloud.beforeSave("GCUR_OBSERVATION", function(request, response) {
	var objId = request.object.id;
	var loc = request.object.get("Location");
	
	if (loc != undefined) {
		var locObjId = loc.id;
		console.log("*** beforeSave triggered on GCUR_OBSERVATION for GCUR_LOCATION: " + locObjId);
	}
	
	if (request.user != undefined) {
		console.log("*** beforeSave requested by _User: " + request.user.id);
	}
	
	var newAreaCuring = newValidatorCuring = newAdminCuring = undefined;
	newAreaCuring = request.object.get("AreaCuring");
	newValidatorCuring = request.object.get("ValidatorCuring");
	newAdminCuring = request.object.get("AdminCuring");
				
	console.log("* AreaCuring[ " + newAreaCuring + "], ValidatorCuring[" + newValidatorCuring + "], AdminCuring[" + newAdminCuring + "]");
	
	var sharedWithJurisArr = [];
	
	if(request.object.isNew()) {
		// Adding a new GCUR_OBSERVATION object
		console.log("Adding a new Observation.");
		var sharedJurisSettingsQ = new Parse.Query("GCUR_SHARED_JURIS_SETTINGS");
		
		sharedJurisSettingsQ.find().then(function(sjsObjs) {
			for (var i = 0; i < sjsObjs.length; i ++) {
				var jurisdiction = sjsObjs[i].get("Jurisdiction");
				sharedWithJurisArr.push(jurisdiction);
			}
			
			var sharedByArr = [];
			
			for (var i = 0; i < sharedWithJurisArr.length; i ++) {
				sharedByArr.push({
					"st" : sharedWithJurisArr[i],
					"sh" : true
				});
			}
			
			request.object.set("SharedBy", JSON.stringify(sharedByArr));
			
			response.success();
		});
	} else {
		// Updating an existing GCUR_OBSERVATION object
		console.log("*** Updating an existing Observation. GCUR_OBSERVATION objectId = " + objId);
		
		if ( (newAreaCuring == undefined) && (newValidatorCuring == undefined) && (newAdminCuring == undefined) ) {
			var queryObservation = new Parse.Query("GCUR_OBSERVATION");
			queryObservation.equalTo("objectId", objId);
			queryObservation.first({
				success: function(object) {
					// Delete this object
					object.destroy({
						success: function(myObject) {
							// The object was deleted from the Parse Cloud.
							console.log("* Object has been successfully deleted as there was no curing values. ");
							response.success();
						},
						error: function(myObject, error) {
							// The delete failed.
							// error is a Parse.Error with an error code and message.
							response.error("Error: " + error.code + " " + error.message);
						}
					});
				},
				error: function(error) {
					console.log("### Observation Object has NOT been retrieved.");
					response.error("Error: " + error.code + " " + error.message);
				}
			});
		} else {
			response.success();
		}
	}
});

/*
 * after a new Observation is added
 */
Parse.Cloud.afterSave("GCUR_OBSERVATION", function(request, response) {
	var objId = request.object.id;
	var loc = request.object.get("Location");
	var locObjId = loc.id;
	console.log("*** afterSave triggered on GCUR_OBSERVATION [" + objId + "] for GCUR_LOCATION [" + locObjId + "]");
	
	if (request.user != undefined) {
		var queryUser = new Parse.Query(Parse.User);
		queryUser.equalTo("objectId", request.user.id);
		
		// Use the new "useMasterKey" option in the Parse Server Cloud Code to bypass ACLs or CLPs.
		queryUser.first({ useMasterKey: true }).then(function (user) {
			var userName = user.get("username");
			console.log("*** afterSave GCUR_OBSERVATION requested by _User [" + userName + "] [" + request.user.id + "]");
		}, function(error) {
			console.log("*** afterSave GCUR_OBSERVATION requested by _User [" + request.user.id + "]");
			console.error("Parse.User table lookup failed. Error: " + error.code + " " + error.message);
		});
	} else {
		console.log("*** afterSave GCUR_OBSERVATION. Requesting user is undefined.");
	}
});

/*
 * after a new Location is added
 */
Parse.Cloud.afterSave("GCUR_LOCATION", function(request, response) {
	var objId = request.object.id;
	var locName = request.object.get("LocationName");

	if (request.user != undefined) {
		var queryUser = new Parse.Query(Parse.User);
		queryUser.equalTo("objectId", request.user.id);
		
		// Use the new "useMasterKey" option in the Parse Server Cloud Code to bypass ACLs or CLPs.
		queryUser.first({ useMasterKey: true }).then(function (user) {
			var userName = user.get("username");
			console.log("*** afterSave GCUR_LOCATION [" + locName + "] [" + objId + "] requested by _User [" + userName + "] [" + request.user.id + "]");
		}, function(error) {
			console.log("*** afterSave GCUR_LOCATION [" + locName + "] [" + objId + "] requested by _User [" + request.user.id + "]");
			console.error("Parse.User table lookup failed. Error: " + error.code + " " + error.message);
		});
	} else {
		console.log("*** afterSave GCUR_LOCATION [" + locName + "] [" + objId + "]. Requesting user is undefined.");
	}
});

/**
 * Retrieve shared infos for shared locations for State
 */
Parse.Cloud.define("getPrevSimpleObsSharedInfoForState", function(request, response) {
	var stateName = request.params.state;
	
	var isBufferZonePntsForStateApplied = true;
	var bufferZonePntsForState = null;
	
	var sharedInfos = [];
	
	var querySharedJurisSettings = new Parse.Query("GCUR_SHARED_JURIS_SETTINGS");
	querySharedJurisSettings.equalTo("Jurisdiction", stateName);		// Find the record for the input jurisdiction

	// Find the "bufferZonePnts" for the input jurisdiction
	// "bufferZonePnts" can be either the set point array, or "null" or "undefined" as well.
	querySharedJurisSettings.first().then(function(jurisSetting) {
		bufferZonePntsForState = jurisSetting.get("bufferZonePnts");
			
		if ((bufferZonePntsForState == null) || (bufferZonePntsForState == undefined))
			isBufferZonePntsForStateApplied = false;
			
		return Parse.Promise.as("'bufferZonePnts' is found for jurisdiction " + stateName);
	}, function(error) {
		console.log("There was an error in finding Class 'GCUR_SHARED_JURIS_SETTINGS', but we continue to find previous observations.");
		return Parse.Promise.as("There was an error in finding Class 'GCUR_SHARED_JURIS_SETTINGS', but we continue to find previous observations.");
	}).then(function() {
		console.log("isBufferZonePntsForStateApplied = " + isBufferZonePntsForStateApplied + " for " + stateName);
		
		var queryObservation = new Parse.Query("GCUR_OBSERVATION");
		queryObservation.include("Location");
		queryObservation.equalTo("ObservationStatus", 1);			// Previous week's observations
		queryObservation.limit(1000);
		
		return queryObservation.find(); 
	}).then(function(obs) {
		for (var j = 0; j < obs.length; j ++) {
			// check if FinalisedDate is 30 days away
			var isPrevObsTooOld = isObsTooOld(obs[j].get("FinalisedDate"));
			if (!isPrevObsTooOld) {
				var loc = obs[j].get("Location");
				var isShareable = loc.get("Shareable");
				var locStatus = loc.get("LocationStatus");
				
				// We only retrieve obs curing for locations that are shareable
				if ( isShareable && (locStatus.toLowerCase() != "suspended") ) {
					var locObjId = loc.id;
					var locName = loc.get("LocationName");
					var distNo = loc.get("DistrictNo");
					var locLat = loc.get("Lat");
					var locLng = loc.get("Lng");
					
					var obsObjId = obs[j].id;
					
					var prevOpsCuring, prevOpsDate;
					if (obs[j].has("AdminCuring")) {
						prevOpsCuring = obs[j].get("AdminCuring");
						prevOpsDate = obs[j].get("AdminDate");
					} else if (obs[j].has("ValidatorCuring")) {
						prevOpsCuring = obs[j].get("ValidatorCuring");
						prevOpsDate = obs[j].get("ValidationDate");
					} else {
						prevOpsCuring = obs[j].get("AreaCuring");
						prevOpsDate = obs[j].get("ObservationDate");
					}
	
					var finalisedDate = obs[j].get("FinalisedDate");
					
					// In Array; convert raw string to JSON Array
					// For example, "[{"st":"VIC","sh":false},{"st":"QLD","sh":true},{"st":"NSW","sh":true}]"
					if (obs[j].has("SharedBy")) {
						
						var sharedByInfo = JSON.parse(obs[j].get("SharedBy"));
						
						var isSharedByState;
						
						for (var p = 0; p < sharedByInfo.length; p ++) {
							if (sharedByInfo[p]["st"] == stateName) {
								isSharedByState = sharedByInfo[p]["sh"];
								
								var returnedItem = {
									"obsObjId" : obsObjId,
									"locObjId"	: locObjId,
									"locName" : locName,
									"locStatus" : locStatus,
									"distNo" : distNo,
									"isSharedByState" : isSharedByState,
									"prevOpsCuring" : prevOpsCuring,
									"prevOpsDate" : prevOpsDate,
									"lat" : locLat,
									"lng" : locLng,
									"finalisedDate" : finalisedDate
								};
								
								sharedInfos.push(returnedItem);
								break;
							}
						}
					}
				}
			}
		}
		
		var returnedObj = {
			"state" : stateName,
			"sharedInfos" : sharedInfos
		};
		
		// If isBufferZonePntsForStateApplied is false OR sharedInfos contains zero element
		if ((isBufferZonePntsForStateApplied == false) || (sharedInfos.length < 1)) {
			console.log("Not to apply buffer zone for " + stateName + " OR sharedInfos contains zero element.");
		}
		// apply Turf package for buffering
		else {
			var searchWithin = {
					"type": "FeatureCollection",
					"features": [
				      {
				    	  "type": "Feature",
				    	  "properties": {},
				    	  "geometry": {
					        "type": "Polygon",
					        "coordinates": new Array()
					      }
				      }
				    ]
			};
			
			bufferZonePntsForState = JSON.parse(bufferZonePntsForState);
			searchWithin["features"][0]["geometry"]["coordinates"].push(bufferZonePntsForState);

			var pointsToCheck = {
					"type": "FeatureCollection",
					"features": []
			};
			
			for (var j = 0; j < sharedInfos.length; j++) {
				var obsObjId = sharedInfos[j]["obsObjId"];
				var lat = sharedInfos[j]["lat"];
				var lng = sharedInfos[j]["lng"];
				
				var featureObj = {
						"type": "Feature",
					    "properties": {"obsObjId" : obsObjId},
					    "geometry": {
					    	"type": "Point",
					    	"coordinates": [lng, lat]
					    }
				};
				
				pointsToCheck["features"].push(featureObj);
			}
			
			// Use Turf to retrieve points that are within the buffer zone
			var ptsWithin = turf.within(pointsToCheck, searchWithin);
			
			var sharedInfosFiltered = [];
			
			console.log("Out of a total of " + sharedInfos.length + " observations, " + ptsWithin["features"].length + " are within the buffer zone of " + stateName);
			
			for (var m = 0; m < ptsWithin["features"].length; m++) {
				for (var n = 0; n < sharedInfos.length; n++) {
					if (ptsWithin["features"][m]["properties"]["obsObjId"] == sharedInfos[n]["obsObjId"]) {
						sharedInfosFiltered.push(sharedInfos[n]);
						break;
					}
				}
			}
			
			returnedObj = {
				"state" : stateName,
				"sharedInfos" : sharedInfosFiltered
			};
		}
		
		return response.success(returnedObj);
	}, function(error) {
		response.error("Error: " + error.code + " " + error.message);
	});
});

/**
 * Retrieve previous curing values (shared only!) for shared locations for State
 * This Cloud function is called from the VISCA model directly!
 */
Parse.Cloud.define("getSharedPrevCuringForStateForInputToVISCA", function(request, response) {
	var stateName = request.params.state;
	
	var isBufferZonePntsForStateApplied = true;
	var bufferZonePntsForState = null;
	
	var sharedObsArr = [];
	
	var querySharedJurisSettings = new Parse.Query("GCUR_SHARED_JURIS_SETTINGS");
	querySharedJurisSettings.equalTo("Jurisdiction", stateName);		// Find the record for the input jurisdiction

	// Find the "bufferZonePnts" for the input jurisdiction
	// "bufferZonePnts" can be either the set point array, or "null" or "undefined" as well.
	querySharedJurisSettings.first().then(function(jurisSetting) {
		bufferZonePntsForState = jurisSetting.get("bufferZonePnts");
			
		if ((bufferZonePntsForState == null) || (bufferZonePntsForState == undefined))
			isBufferZonePntsForStateApplied = false;
			
		return Parse.Promise.as("'bufferZonePnts' is found for jurisdiction " + stateName);
	}, function(error) {
		console.log("There was an error in finding Class 'GCUR_SHARED_JURIS_SETTINGS', but we continue to find previous observations.");
		return Parse.Promise.as("There was an error in finding Class 'GCUR_SHARED_JURIS_SETTINGS', but we continue to find previous observations.");
	}).then(function() {
		console.log("isBufferZonePntsForStateApplied = " + isBufferZonePntsForStateApplied + " for " + stateName);
	
		var queryObservation = new Parse.Query("GCUR_OBSERVATION");
		queryObservation.include("Location");
		queryObservation.equalTo("ObservationStatus", 1);			// Previous week's observations
		queryObservation.limit(1000);
	
		return queryObservation.find();
	}).then(function(obs) {
		for (var j = 0; j < obs.length; j ++) {
			// check if FinalisedDate is 30 days away
			var isPrevObsTooOld = isObsTooOld(obs[j].get("FinalisedDate"));
			if (!isPrevObsTooOld) {
				var loc = obs[j].get("Location");
				var isShareable = loc.get("Shareable");
				var locStatus = loc.get("LocationStatus");
				
				// We only retrieve obs curing for locations that are shareable
				if ( isShareable && (locStatus.toLowerCase() != "suspended") ) {
					var locObjId = loc.id;
					var locName = loc.get("LocationName");
					var locLat = loc.get("Lat");
					var locLng = loc.get("Lng");
					
					var obsObjId = obs[j].id;
					
					var prevOpsCuring;
					if (obs[j].has("AdminCuring")) {
						prevOpsCuring = obs[j].get("AdminCuring");
					} else if (obs[j].has("ValidatorCuring")) {
						prevOpsCuring = obs[j].get("ValidatorCuring");
					} else {
						prevOpsCuring = obs[j].get("AreaCuring");
					}
					
					// In Array; convert raw string to JSON Array
					// For example, "[{"st":"VIC","sh":false},{"st":"QLD","sh":true},{"st":"NSW","sh":true}]"
					if (obs[j].has("SharedBy")) {
						
						var sharedByInfo = JSON.parse(obs[j].get("SharedBy"));
						
						var isSharedByState;
						
						for (var p = 0; p < sharedByInfo.length; p ++) {
							if ( (sharedByInfo[p]["st"] == stateName) && (sharedByInfo[p]["sh"]) ) {
								var sharedObs = {
									"obsObjId" : obsObjId,
									"locObjId"	: locObjId,
									"locName" : locName,
									"bestCuring" : prevOpsCuring,
									"lat" : locLat,
									"lng" : locLng
								};
								
								sharedObsArr.push(sharedObs);
								break;
							}
						}
					}
				}
			}
		}
		
		// Sort by locName, case-insensitive, A-Z
		sharedObsArr.sort(sort_by('locName', false, function(a){return a.toUpperCase()}));
		
		var returnedObj = {
			"state" : stateName,
			"sharedObsArr" : sharedObsArr
		};
		
		// If isBufferZonePntsForStateApplied is false OR sharedObsArr contains zero element
		if ((isBufferZonePntsForStateApplied == false) || (sharedObsArr.length < 1)) {
			console.log("Not to apply buffer zone for " + stateName + " OR sharedObsArr contains zero element.");
		}
		// apply Turf package for buffering
		else {
			var searchWithin = {
					"type": "FeatureCollection",
					"features": [
				      {
				    	  "type": "Feature",
				    	  "properties": {},
				    	  "geometry": {
					        "type": "Polygon",
					        "coordinates": new Array()
					      }
				      }
				    ]
			};
			
			bufferZonePntsForState = JSON.parse(bufferZonePntsForState);
			searchWithin["features"][0]["geometry"]["coordinates"].push(bufferZonePntsForState);

			var pointsToCheck = {
					"type": "FeatureCollection",
					"features": []
			};
			
			for (var j = 0; j < sharedObsArr.length; j++) {
				var obsObjId = sharedObsArr[j]["obsObjId"];
				var lat = sharedObsArr[j]["lat"];
				var lng = sharedObsArr[j]["lng"];
				
				var featureObj = {
						"type": "Feature",
					    "properties": {"obsObjId" : obsObjId},
					    "geometry": {
					    	"type": "Point",
					    	"coordinates": [lng, lat]
					    }
				};
				
				pointsToCheck["features"].push(featureObj);
			}
			
			// Use Turf to retrieve points that are within the buffer zone
			var ptsWithin = turf.within(pointsToCheck, searchWithin);
			
			var sharedObsArrFiltered = [];
			
			console.log("Out of a total of " + sharedObsArr.length + " observations, " + ptsWithin["features"].length + " are within the buffer zone of " + stateName);
			
			for (var m = 0; m < ptsWithin["features"].length; m++) {
				for (var n = 0; n < sharedObsArr.length; n++) {
					if (ptsWithin["features"][m]["properties"]["obsObjId"] == sharedObsArr[n]["obsObjId"]) {
						sharedObsArrFiltered.push(sharedObsArr[n]);
						break;
					}
				}
			}
			
			returnedObj = {
				"state" : stateName,
				"sharedObsArr" : sharedObsArrFiltered
			};
		}
		
		return response.success(returnedObj);
	}, function(error) {
		response.error("Error: " + error.code + " " + error.message);
	});
});

Parse.Cloud.define("updateSharedByInfo", function(request, response) {
	/*
	 * "{\"forState\":\"NSW\", \"sharedInfos\":[{\"obsObjId\":\"syCUGywaao\", \"sh\":true},{\":[{\"obsObjId\":\"TuhtjP9rke\", \"sh\":false},{\":[{\"obsObjId\":\"YEWf4x4oSl\", \"sh\":true}]}" 
	 */
	var forState = request.params.forState;
	var sharedInfos = request.params.sharedInfos;
	
	var obsObjIds = [];
	
	for (var i = 0; i < sharedInfos.length; i ++) {
		obsObjIds.push(sharedInfos[i]["obsObjId"]);
	}
	
	// Finds GCUR_OBSERVATION from any of objectId from the input obsObjId array
	var queryObservation = new Parse.Query("GCUR_OBSERVATION");
	queryObservation.containedIn("objectId", obsObjIds);
	queryObservation.limit(1000);
	queryObservation.find().then(function(obs) {
		// loops through all Observation records contained in the input obs list
		for (var j = 0; j < obs.length; j ++) {
			for (var i = 0; i < sharedInfos.length; i ++) {
				if (obs[j].id == sharedInfos[i]["obsObjId"]) {
					
					// [{"st":"VIC","sh":true},{"st":"QLD","sh":true},{"st":"NSW","sh":false}]
					var oldSharedBy = JSON.parse(obs[j].get("SharedBy"));
					var newIsSharedForState = sharedInfos[i]["sh"];
					
					for (var p = 0; p < oldSharedBy.length; p ++) {
						// re-set the SharedBy array with the new "sh" boolean
						if (oldSharedBy[p]["st"] == forState) {
							oldSharedBy[p]["sh"] = newIsSharedForState;
							break;
						}
					}
					
					obs[j].set("SharedBy", JSON.stringify(oldSharedBy));
					break ;
				}
			}
		}
		return Parse.Object.saveAll(obs);
		//return response.success();
	}).then(function(obsList) {
		// All the objects were saved.
		console.log("Updated SharedBy column on GCUR_OBSERVATION table. Updated obs count: " + obsList.length);
		response.success(true);  //saveAll is now finished and we can properly exit with confidence :-)
	}, function(error) {
		response.error("Error: " + error.code + " " + error.message);
	});
});

/**
 * Removes all associated GCUR_OBSERVATION and GCUR_MMR_OBSERVER_LOCATION records
 *  when a GCUR_LOCATION is deleted
 */
Parse.Cloud.afterDelete("GCUR_LOCATION", function(request) {
	query = new Parse.Query("GCUR_OBSERVATION");
	query.equalTo("Location", request.object);
	query.limit(1000);
	query.find().then(function(observations) {
		return Parse.Object.destroyAll(observations);
	}).then(function() {
		console.log('All associated GCUR_OBSERVATION records for the deleted GCUR_LOCATION have been deleted.');
		return Parse.Promise.as("Hello!");
	}, function(error) {
		console.log('Failed to delete all associated GCUR_OBSERVATION records for the deleted GCUR_LOCATION.');
		return Parse.Promise.as("Hello!");
	}).then(function() {
		queryMMR = new Parse.Query("GCUR_MMR_OBSERVER_LOCATION");
		queryMMR.equalTo("Location", request.object);
		queryMMR.limit(1000);
		return queryMMR.find();
	}).then(function(mmrObserversLocations) {
		return Parse.Object.destroyAll(mmrObserversLocations);
	}).then(function() {
		console.log('All associated GCUR_MMR_OBSERVER_LOCATION records for the deleted GCUR_LOCATION have been deleted.');
	}, function(error) {
		console.log('Failed to delete all associated GCUR_MMR_OBSERVER_LOCATION records for the deleted GCUR_LOCATION.');
	});
});


/**
 * Removes all associated GCUR_MMR_OBSERVER_LOCATION and GCUR_MMR_USER_ROLE records
 *  when a Parse.User row is deleted
 */
Parse.Cloud.afterDelete(Parse.User, function(request) {
	var mmrObsvrLocsCount;
	var mmrUsrRoleCount;
	query = new Parse.Query("GCUR_MMR_OBSERVER_LOCATION");
	query.equalTo("Observer", request.object);
	query.limit(1000);
	query.find().then(function(mmr_obsvr_locs) {
		mmrObsvrLocsCount = mmr_obsvr_locs.length;
		return Parse.Object.destroyAll(mmr_obsvr_locs);
	}).then(function() {
		console.log('All associated GCUR_MMR_OBSERVER_LOCATION records for the deleted User have been deleted: ' + mmrObsvrLocsCount);
		return Parse.Promise.as("Hello!");
	}, function(error) {
		console.log('Failed to delete all associated GCUR_MMR_OBSERVER_LOCATION records for the deleted User.');
		return Parse.Promise.as("Hello!");
	}).then(function() {
		queryMMR = new Parse.Query("GCUR_MMR_USER_ROLE");
		queryMMR.equalTo("user", request.object);
		queryMMR.limit(1000);
		return queryMMR.find();
	}).then(function(mmr_user_roles) {
		mmrUsrRoleCount = mmr_user_roles.length;
		return Parse.Object.destroyAll(mmr_user_roles);
	}).then(function() {
		console.log('All associated GCUR_MMR_USER_ROLE records for the deleted User have been deleted: ' + mmrUsrRoleCount);
	}, function(error) {
		console.log('Failed to delete all associated GCUR_MMR_USER_ROLE records for the deleted User.');
	});
});

/**
 * Removes the associated files uploaded before the Run Model record is deleted
 * including viscaFile, FuelLoadBoMFile and FuelLoadMidRangeFile.
 */
Parse.Cloud.beforeDelete("GCUR_RUNMODEL", function(request, response) {
	var viscaFileExist = false;
	var FuelLoadBoMFileExist = false;
	var FuelLoadMidRangeFileExist = false;
	
	var start = Parse.Promise.as("start");
	
	start.then(function() {
		if (request.object.has("viscaFile")) {
			viscaFileExist = true;
			var file = request.object.get("viscaFile");
			var fileName = file.name();
			console.log("viscaFile found; continue to delete it: " + file.name());
			return Parse.Cloud.httpRequest({
				method: 'DELETE',
				url: SERVER_URL + "/files/" + fileName,
				headers: {
					"X-Parse-Application-Id": APP_ID,
					"X-Parse-Master-Key" : MASTER_KEY
				}
			});
		} else {
			console.log('GCUR_RUNMODEL object to be deleted does not have an associated viscaFile (File). No viscaFile to be deleted.');
			return Parse.Promise.as("GCUR_RUNMODEL has no viscaFile.");
		}
	}).then(function() {
		if (viscaFileExist)
			console.log("viscaFile successfully deleted. We continue to delete FuelLoadBoMFile.");
		else
			console.log("viscaFile not found. We continue to delete FuelLoadBoMFile.");
		
		return Parse.Promise.as("Continue to delete FuelLoadBoMFile.");
	}, function(error) {
		console.error("Failed to delete viscaFile. We continue to delete FuelLoadBoMFile now... ... Error code: " + error.message);
		return Parse.Promise.as("Failed to delete viscaFile. We continue to delete FuelLoadBoMFile now... ...");
	}).then(function() {
		if (request.object.has("FuelLoadBoMFile")) {
			FuelLoadBoMFileExist = true;
			var file = request.object.get("FuelLoadBoMFile");
			var fileName = file.name();
			console.log("FuelLoadBoMFile found; continue to delete it: " + file.name());
			return Parse.Cloud.httpRequest({
				method: 'DELETE',
				url: SERVER_URL + "/files/" + fileName,
				headers: {
					"X-Parse-Application-Id": APP_ID,
					"X-Parse-Master-Key" : MASTER_KEY
				}
			});
		} else {
			console.log('GCUR_RUNMODEL object to be deleted does not have an associated FuelLoadBoMFile (File). No FuelLoadBoMFile to be deleted.');
			return Parse.Promise.as("GCUR_RUNMODEL has no FuelLoadBoMFile.");
		}
	}).then(function() {
		if (FuelLoadBoMFileExist)
			console.log("FuelLoadBoMFile successfully deleted. We continue to delete FuelLoadMidRangeFile.");
		else
			console.log("FuelLoadBoMFile not found. We continue to delete FuelLoadMidRangeFile.");
		
		return Parse.Promise.as("Continue to delete FuelLoadMidRangeFile.");
	}, function(error) {
		console.error("Failed to delete FuelLoadBoMFile. We continue to delete FuelLoadMidRangeFile now... ... Error code: " + error.message);
		return Parse.Promise.as("Failed to delete FuelLoadBoMFile. We continue to delete FuelLoadMidRangeFile now... ...");
	}).then(function() {
		if (request.object.has("FuelLoadMidRangeFile")) {
			FuelLoadMidRangeFileExist = true;
			var file = request.object.get("FuelLoadMidRangeFile");
			var fileName = file.name();
			console.log("FuelLoadMidRangeFile found; continue to delete it: " + file.name());
			return Parse.Cloud.httpRequest({
				method: 'DELETE',
				url: SERVER_URL + "/files/" + fileName,
				headers: {
					"X-Parse-Application-Id": APP_ID,
					"X-Parse-Master-Key" : MASTER_KEY
				}
			});
		} else {
			console.log('GCUR_RUNMODEL object to be deleted does not have an associated FuelLoadMidRangeFile (File). No FuelLoadMidRangeFile to be deleted.');
			return Parse.Promise.as("GCUR_RUNMODEL has no FuelLoadMidRangeFile.");
		}
	}).then(function() {
		if (FuelLoadMidRangeFileExist)
			console.log("FuelLoadMidRangeFile successfully deleted. Complete deleting files associated with the RunModel object.");
		else
			console.log("FuelLoadMidRangeFile not found. Complete deleting files associated with the RunModel object.");
			
		return Parse.Promise.as("Complete deleting files associated with the RunModel record.");
	}, function(error) {
		console.error("Failed to delete FuelLoadMidRangeFile. Complete deleting files associated with the RunModel record. Error code: " + error.message);
		return Parse.Promise.as("Failed to delete FuelLoadMidRangeFile. Complete deleting files associated with the RunModel object.");
	}).then(function() {
		response.success();
	});
});

/**
 * Removes the associated viscaMapFile, FuelLoadBoMMapFile and FuelLoadMidRangeMapFile uploaded before the Finalise Model record is deleted
 */
Parse.Cloud.beforeDelete("GCUR_FINALISEMODEL", function(request, response) {
	var viscaMapFileExist = false;
	var FuelLoadBoMMapFileExist = false;
	var FuelLoadMidRangeMapFileExist = false;
	
	var start = Parse.Promise.as("start");
	
	start.then(function() {
		if (request.object.has("viscaMapFile")) {
			viscaMapFileExist = true;
			var file = request.object.get("viscaMapFile");
			var fileName = file.name();
			console.log("viscaMapFile found; continue to delete it: " + file.name());
			return Parse.Cloud.httpRequest({
				method: 'DELETE',
				url: SERVER_URL + "/files/" + fileName,
				headers: {
					"X-Parse-Application-Id": APP_ID,
					"X-Parse-Master-Key" : MASTER_KEY
				}
			});
		} else {
			console.log('GCUR_FINALISEMODEL object to be deleted does not have an associated viscaMapFile (File). No viscaMapFile to be deleted.');
			return Parse.Promise.as("GCUR_FINALISEMODEL has no viscaMapFile.");
		}
	}).then(function() {
		if (viscaMapFileExist)
			console.log("viscaMapFile successfully deleted. We continue to delete FuelLoadBoMMapFile.");
		else
			console.log("viscaMapFile not found. We continue to delete FuelLoadBoMMapFile.");
		
		return Parse.Promise.as("Continue to delete FuelLoadBoMMapFile.");
	}, function(error) {
		console.error("Failed to delete viscaMapFile. We continue to delete FuelLoadBoMMapFile now... ... Error code: " + error.message);
		return Parse.Promise.as("Failed to delete viscaMapFile. We continue to delete FuelLoadBoMMapFile now... ...");
	}).then(function() {
		if (request.object.has("FuelLoadBoMMapFile")) {
			FuelLoadBoMMapFileExist = true;
			var file = request.object.get("FuelLoadBoMMapFile");
			var fileName = file.name();
			console.log("FuelLoadBoMMapFile found; continue to delete it: " + file.name());
			return Parse.Cloud.httpRequest({
				method: 'DELETE',
				url: SERVER_URL + "/files/" + fileName,
				headers: {
					"X-Parse-Application-Id": APP_ID,
					"X-Parse-Master-Key" : MASTER_KEY
				}
			});
		} else {
			console.log('GCUR_FINALISEMODEL object to be deleted does not have an associated FuelLoadBoMMapFile (File). No FuelLoadBoMMapFile to be deleted.');
			return Parse.Promise.as("GCUR_FINALISEMODEL has no FuelLoadBoMMapFile.");
		}
	}).then(function() {
		if (FuelLoadBoMMapFileExist)
			console.log("FuelLoadBoMMapFile successfully deleted. We continue to delete FuelLoadMidRangeMapFile.");
		else
			console.log("FuelLoadBoMMapFile not found. We continue to delete FuelLoadMidRangeMapFile.");
		
		return Parse.Promise.as("Continue to delete FuelLoadMidRangeMapFile.");
	}, function(error) {
		console.error("Failed to delete FuelLoadBoMMapFile. We continue to delete FuelLoadMidRangeMapFile now... ... Error code: " + error.message);
		return Parse.Promise.as("Failed to delete FuelLoadBoMMapFile. We continue to delete FuelLoadMidRangeMapFile now... ...");
	}).then(function() {
		if (request.object.has("FuelLoadMidRangeMapFile")) {
			FuelLoadMidRangeMapFileExist = true;
			var file = request.object.get("FuelLoadMidRangeMapFile");
			var fileName = file.name();
			console.log("FuelLoadMidRangeMapFile found; continue to delete it: " + file.name());
			return Parse.Cloud.httpRequest({
				method: 'DELETE',
				url: SERVER_URL + "/files/" + fileName,
				headers: {
					"X-Parse-Application-Id": APP_ID,
					"X-Parse-Master-Key" : MASTER_KEY
				}
			});
		} else {
			console.log('GCUR_FINALISEMODEL object to be deleted does not have an associated FuelLoadMidRangeMapFile (File). No FuelLoadMidRangeMapFile to be deleted.');
			return Parse.Promise.as("GCUR_FINALISEMODEL has no FuelLoadMidRangeMapFile.");
		}
	}).then(function() {
		if (FuelLoadMidRangeMapFileExist)
			console.log("FuelLoadMidRangeMapFile successfully deleted. Complete deleting files associated with the FinaliseModel object.");
		else
			console.log("FuelLoadMidRangeMapFile not found. Complete deleting files associated with the FinaliseModel object.");
			
		return Parse.Promise.as("Complete deleting files associated with the FinaliseModel record.");
	}, function(error) {
		console.error("Failed to delete FuelLoadMidRangeMapFile. Complete deleting files associated with the FinaliseModel record. Error code: " + error.message);
		return Parse.Promise.as("Failed to delete FuelLoadMidRangeMapFile. Complete deleting files associated with the FinaliseModel object.");
	}).then(function() {
		response.success();
	});
});

Parse.Cloud.define("deleteRunModelById", function(request, response) {
	var objectId = request.params.objectId;
	
	var queryRunModel = new Parse.Query("GCUR_RUNMODEL");
	queryRunModel.equalTo("objectId", objectId);
	queryRunModel.limit(1000);
	queryRunModel.find().then(function(results) {
		console.log(results.length + " GCUR_RUNMODEL found for objectId [" + objectId + "]. Ready to be destroyed by the function deleteRunModelById!");
		return Parse.Object.destroyAll(results);
	}, function(error) {
		console.log("GCUR_RUNMODEL table lookup failed");
	    response.success(false);
	}).then(function() {
		console.log('GCUR_RUNMODEL record [' + objectId + '] successfully deleted.');
		response.success(true);
	}, function(error) {
		// An error occurred while deleting one or more of the objects.
		// If this is an aggregate error, then we can inspect each error
		// object individually to determine the reason why a particular
		// object was not deleted.
	    if (error.code === Parse.Error.AGGREGATE_ERROR) {
	    	for (var i = 0; i < error.errors.length; i++) {
	          console.log("Couldn't delete " + error.errors[i].object.id +
	            "due to " + error.errors[i].message);
	        }
	    } else {
	    	console.log("Delete aborted because of " + error.message);
	    }
		console.log('Failed to delete GCUR_RUNMODEL record[' + objectId + '].');
		response.success(false);
	});
});

/**
 * Retrieve a list RunModel jobs by a list of ObjectIds
 */
Parse.Cloud.define("getRunModelDetails", function(request, response) {
	var inRunModelObjList = [];
	var outRunModelDetails = [];
	
	for (var i = 0; i < request.params.runModelObjIds.length; i ++) {
		console.log("Getting RunModel Details for ObjectId [" + request.params.runModelObjIds[i]["objectId"] + "]");
		inRunModelObjList.push(request.params.runModelObjIds[i]["objectId"]);
	}
	
	// Query GCUR_RUNMODEL class
	var queryRunModel = new Parse.Query("GCUR_RUNMODEL");
	queryRunModel.containedIn("objectId", inRunModelObjList);
	queryRunModel.include("submittedBy");	// Retrieve _USER
	queryRunModel.limit(1000);
	queryRunModel.find({ useMasterKey: true }).then(function(results) {
		for (var j = 0; j < results.length; j ++) {
			var objectId = results[j].id;
			var createdAt = results[j].createdAt;
			var updatedAt = results[j].updatedAt;
			var jobResult = results[j].get("jobResult");
			var jobResultDetails = results[j].get("jobResultDetails");
			var status = results[j].get("status");
			var viscaFile = results[j].get("viscaFile");
			var FuelLoadBOMFile = results[j].get("FuelLoadBoMFile");
			var FuelLoadMidRangeFile = results[j].get("FuelLoadMidRangeFile");
			var resolution = results[j].get("resolution");
			
			var submittedBy = results[j].get("submittedBy");
	        var userObjId = submittedBy.id;
	        var firstname = submittedBy.get("firstName");
	        var lastname = submittedBy.get("lastName");
	        
	        var jobDetail = {
	        		"objectId" : objectId,
	        		"createdAt" : createdAt,
	        		"updatedAt" : updatedAt,
	        		"jobResult" : jobResult,
	        		"jobResultDetails" : jobResultDetails,
	        		"status" : status,
	        		"viscaFile" : viscaFile,
	        		"FuelLoadBOMFile" : FuelLoadBOMFile,
	        		"FuelLoadMidRangeFile" : FuelLoadMidRangeFile,
	        		"resolution" : resolution,
	        		"submittedByUserOID" : userObjId,
	        		"submittedByUserFullName" : firstname + " " + lastname
	        };
	        
	        outRunModelDetails.push(jobDetail);
		}
		return response.success(outRunModelDetails);
	}, function(error) {
		response.error("Error: " + error.code + " " + error.message);
	});
});

Parse.Cloud.define("getAllSimpleMMRUserRoleForRole", function(request, response) {
  var roleObjectId = request.params.objectId;
  var roleName = null;
  
  var queryRole = new Parse.Query(Parse.Role);
  queryRole.equalTo("objectId", roleObjectId);
  queryRole.find().then(function (roles) {
	  roleName = roles[0].get("name");
	  
	  var queryMMR = new Parse.Query("GCUR_MMR_USER_ROLE");
	  // Include the post data with each comment
	  queryMMR.include("user");
	  queryMMR.include("role");
	  queryMMR.limit(1000);
	  return queryMMR.find({ useMasterKey: true });
  }).then(function(results) {
	  var userStatsusForRole = null;
      var userStatusList = []
      
      for (var i = 0; i < results.length; i++) {

        var role = results[i].get("role");
        var roleObjId = role.id;
        if (roleObjId == roleObjectId) {
        	roleName = role.get("name");
        	var user = results[i].get("user");
            var username = user.get("username");
            var firstname = user.get("firstName");
            var lastname = user.get("lastName");
            var email = user.get("email");
            var userObjId = user.id;
            var simpleUser = {
              "objectId": userObjId,
    		  "username": username,
    		  "firstName": firstname,
    		  "lastName": lastname,
    		  "email": email
    	    };
            
            var status = results[i].get("status");
            var thisMMRObjIid = results[i].id;
            
            var userStatus = {
              "simpleUser": simpleUser,
              "status": status,
              "thisMMRObjId" : thisMMRObjIid
            };

            userStatusList.push(userStatus);
        }
      }
      userStatsusForRole = {
        "roleObjectId": roleObjectId,
        "roleName": roleName,
        "userStatusList": userStatusList
      }
      response.success(userStatsusForRole);
  }, function(error) {
	  response.error("GCUR_MMR_USER_ROLE lookup failed");
  });
});

Parse.Cloud.define("getAllSimpleMMRUserRoleForUser", function(request, response) {
	var userObjectId = request.params.objectId;
	var userName = null;
	
	var queryUser = new Parse.Query(Parse.User);
	queryUser.equalTo("objectId", userObjectId);
	queryUser.first({ useMasterKey: true }).then(function (user) {
		  userName = user.get("username");
		  var queryMMR = new Parse.Query("GCUR_MMR_USER_ROLE");
		  // Include the post data with each comment
		  queryMMR.include("user");
		  queryMMR.include("role");
		  queryMMR.limit(1000);
		  return queryMMR.find({ useMasterKey: true });
	}).then(function(results) {
		  var roleStatsusForUser = null;
	      var roleStatusList = []
	      
	      for (var i = 0; i < results.length; i++) {

	        var user = results[i].get("user");
	        var usrObjId = user.id;
	        if (usrObjId == userObjectId) {
	        	var role = results[i].get("role");
	            var roleName = role.get("name");
	            var roleObjId = role.id;
	            var simpleRole = {
	              "objectId": roleObjId,
	    		  "roleName": roleName
	    	    };
	            
	            var status = results[i].get("status");
	            
	            var roleStatus = {
	              "simpleRole": simpleRole,
	              "status": status
	            };

	            roleStatusList.push(roleStatus);
	        }
	      }
	      roleStatsusForUser = {
	        "userObjectId": userObjectId,
	        "userName": userName,
	        "roleStatusList": roleStatusList
	      }
	      response.success(roleStatsusForUser);
	  }, function(error) {
		  response.error("Error: " + error.code + " " + error.message);
	  });
	});

Parse.Cloud.define("getSimpleObservationsForUser", function(request, response) {
	var userObjectId = request.params.objectId;
	var userRoleName = request.params.roleName;
	var obsList = [];	// the output array for response
	
	/*
	 * An example of result
		{
		  "result":[
		    {
		      "locationName":"AMBERLEY",
		      "locationObjId":"4n0uDuAOOj",
		      "locationStatus":"mandatory",
		      "observationObjId":"6C52oI52HR",
		      "prevOpsCuring":50,
		      "validatorCuring":70
		    },
		    {
		      "adminCuring":90,
		      "areaCuring":50,
		      "locationName":"BEERBURRUM",
		      "locationObjId":"jiACvkSLiu",
		      "locationStatus":"mandatory",
		      "observationObjId":"CGoRi9cS29",
		      "validatorCuring":100
		    },
		    {
		      "locationName":"DALBY",
		      "locationObjId":"Wux0DcvNEq",
		      "locationStatus":"optional",
		      "prevOpsCuring":90
		    }
		  ]
		}
	 */
	
	// if the user is of Observers role, we look into the MMR table first to fetch all Active locations associated
	if (userRoleName == "Observers") {
		var queryMMR = new Parse.Query("GCUR_MMR_OBSERVER_LOCATION");
		// Include the post data with each comment
		queryMMR.include("Observer");
		queryMMR.include("Location");
		queryMMR.limit(1000);
		queryMMR.find({ useMasterKey: true }).then(function(results) {
			// Create a trivial resolved promise as a base case.
		    var promises = [];
		    // each result is a GCUR_MMR_OBSERVER_LOCATION row
		    _.each(results, function(result) {
		    	var observer = result.get("Observer");
				var observerObjId = observer.id;
				
				// when Observer matches the param
				if (observerObjId == userObjectId) {
					var location = result.get("Location");
					var locationObjId = location.id;
					var locationName = location.get("LocationName");
					var locationStatus = location.get("LocationStatus");
					var locationLat = location.get("Lat");
					var locationLng = location.get("Lng");
					var locationShareable = location.get("Shareable");
					
					var obs = null;
					
					var SUSPENDED_STR = "suspended";
					// Only find observation record for those locations that are not suspended
		            if(locationStatus.toLowerCase() != SUSPENDED_STR.toLowerCase()) {
		            	var queryObservation = new Parse.Query("GCUR_OBSERVATION");
						queryObservation.equalTo("Location", location);	// By _Pointer
						queryObservation.limit(1000);
						queryObservation.notEqualTo("ObservationStatus", 2);	// excludes the archived observation
						queryObservation.ascending("ObservationStatus");	// this enables fetching current(0) and previous(1) observations
						
						promises.push(queryObservation.find({
							success : function(results) {
								// results are JavaScript Array of GCUR_OBSERVATION objects
								
								var observationObjId, areaCuring, validatorCuring, adminCuring, validated;
								var prevOpsCuring;
								var fuelLoadCategory;
								
								// result length = 0 if there is no observation
								// result length = 1 if there is either current or previous observation; further checking is required
								// result length = 2 if there are both current and previous observations
								
								if (results.length > 0) {
									// Only previous observation exists for the Location
									if ((results.length == 1) && (results[0].get("ObservationStatus") == 1)) {
										// results[0] is GCUR_OBSERVATION for previous observation
										
										// check if FinalisedDate is 30 days away
										var isPrevObsTooOld = isObsTooOld(results[0].get("FinalisedDate"));
										if (!isPrevObsTooOld) {
											if (results[0].has("AdminCuring")) {
												prevOpsCuring = results[0].get("AdminCuring");
											} else if (results[0].has("ValidatorCuring")) {
												prevOpsCuring = results[0].get("ValidatorCuring");
											} else {
												prevOpsCuring = results[0].get("AreaCuring");
											}
										}
									} else {
										// current observation exists
										observationObjId = results[0].id;
										if (results[0].has("AreaCuring"))
											areaCuring = results[0].get("AreaCuring");
										if (results[0].has("ValidatorCuring"))
											validatorCuring = results[0].get("ValidatorCuring");
										if (results[0].has("AdminCuring"))
											adminCuring = results[0].get("AdminCuring");
										if (results[0].has("FuelLoadCategory"))
											fuelLoadCategory = results[0].get("FuelLoadCategory");
										
										if (results[0].has("ValidatorCuring") || results[0].has("AdminCuring"))
											validated = "validated";
										
										if (results.length == 2) {
											// results[1] is GCUR_OBSERVATION for previous observation
											
											// check if FinalisedDate is 30 days away
											var isPrevObsTooOld = isObsTooOld(results[1].get("FinalisedDate"));
											if (!isPrevObsTooOld) {
												if (results[1].has("AdminCuring")) {
													prevOpsCuring = results[1].get("AdminCuring");
												} else if (results[1].has("ValidatorCuring")) {
													prevOpsCuring = results[1].get("ValidatorCuring");
												} else {
													prevOpsCuring = results[1].get("AreaCuring");
												}
											}
										}
									}
								}
								
								obs = {
									"locationObjId" : 	locationObjId,
									"locationName" : locationName,
									"locationStatus" : locationStatus,
									"locationLat": locationLat,
									"locationLng": locationLng,
									"locationShareable" : locationShareable,
									"observationObjId" : observationObjId,
									"areaCuring" : areaCuring,
									"validatorCuring" : validatorCuring,
									"adminCuring" : adminCuring,
									"validated" : validated,
									"prevOpsCuring" : prevOpsCuring,
									"fuelLoadCategory" : fuelLoadCategory
								};
								obsList.push(obs);							
							},
							error : function(error) {
								return Parse.Promise.error("There was an error in finding Observations.");
							}
						}));
		            }
				}
		    });
		    // Return a new promise that is resolved when all of the promises are resolved
		    return Parse.Promise.when(promises);
		}).then(function() {
		    response.success(obsList);
		}, function(error) {
			  response.error("Error: " + error.code + " " + error.message);
		});
		
	// If the user is Validator or Administrator
	} else {
		var queryLocation = new Parse.Query("GCUR_LOCATION");
		queryLocation.ascending("LocationName");
		queryLocation.limit(1000);
		queryLocation.find().then(function(results) {
			// Create a trivial resolved promise as a base case.
		    var promises = [];
		    // each result is a GCUR_LOCATION row
		    _.each(results, function(result) {
					var location = result;
					var locationObjId = location.id;
					var locationName = location.get("LocationName");
					var locationStatus = location.get("LocationStatus");
					var locationLat = location.get("Lat");
					var locationLng = location.get("Lng");
					var locationShareable = location.get("Shareable");
					
					var obs = null;
					
					var SUSPENDED_STR = "suspended";
					// Only find observation record for those locations that are not suspended
					if(locationStatus.toLowerCase() != SUSPENDED_STR.toLowerCase()) {
		            	var queryObservation = new Parse.Query("GCUR_OBSERVATION");
						queryObservation.equalTo("Location", location);	// By _Pointer
						queryObservation.limit(1000);
						queryObservation.notEqualTo("ObservationStatus", 2);	// excludes the archived observation
						queryObservation.ascending("ObservationStatus");	// this enables fetching current(0) and previous(1) observations
						
						promises.push(queryObservation.find({
							success : function(results) {
								// results are JavaScript Array of GCUR_OBSERVATION objects
								
								var observationObjId, areaCuring, validatorCuring, adminCuring, validated;
								var prevOpsCuring;
								var fuelLoadCategory, validatorFuelLoadCategory;
								
								// result length = 0 if there is no observation
								// result length = 1 if there is either current or previous observation; further checking is required
								// result length = 2 if there are both current and previous observations
								
								if (results.length > 0) {
									// Only previous observation exists for the Location
									if ((results.length == 1) && (results[0].get("ObservationStatus") == 1)) {
										// results[0] is GCUR_OBSERVATION for previous observation
										
										// check if FinalisedDate is 30 days away
										var isPrevObsTooOld = isObsTooOld(results[0].get("FinalisedDate"));
										if (!isPrevObsTooOld) {
											if (results[0].has("AdminCuring")) {
												prevOpsCuring = results[0].get("AdminCuring");
											} else if (results[0].has("ValidatorCuring")) {
												prevOpsCuring = results[0].get("ValidatorCuring");
											} else {
												prevOpsCuring = results[0].get("AreaCuring");
											}
										}
									} else {
										// current observation exists
										observationObjId = results[0].id;
										if (results[0].has("AreaCuring"))
											areaCuring = results[0].get("AreaCuring");
										if (results[0].has("ValidatorCuring"))
											validatorCuring = results[0].get("ValidatorCuring");
										if (results[0].has("AdminCuring"))
											adminCuring = results[0].get("AdminCuring");
										if (results[0].has("FuelLoadCategory"))
											fuelLoadCategory = results[0].get("FuelLoadCategory");
										if (results[0].has("ValidatorFuelLoadCategory"))
											validatorFuelLoadCategory = results[0].get("ValidatorFuelLoadCategory");
										
										if (results[0].has("ValidatorCuring") || results[0].has("AdminCuring"))
											validated = "validated";
										
										if (results.length == 2) {
											// results[1] is GCUR_OBSERVATION for previous observation
											// check if FinalisedDate is 30 days away
											var isPrevObsTooOld = isObsTooOld(results[1].get("FinalisedDate"));
											if (!isPrevObsTooOld) {
												if (results[1].has("AdminCuring")) {
													prevOpsCuring = results[1].get("AdminCuring");
												} else if (results[1].has("ValidatorCuring")) {
													prevOpsCuring = results[1].get("ValidatorCuring");
												} else {
													prevOpsCuring = results[1].get("AreaCuring");
												}
											}
										}
									}
								}
								
								obs = {
									"locationObjId" : 	locationObjId,
									"locationName" : locationName,
									"locationStatus" : locationStatus,
									"locationLat": locationLat,
									"locationLng": locationLng,
									"locationShareable" : locationShareable,
									"observationObjId" : observationObjId,
									"areaCuring" : areaCuring,
									"validatorCuring" : validatorCuring,
									"adminCuring" : adminCuring,
									"validated" : validated,
									"prevOpsCuring" : prevOpsCuring,
									"fuelLoadCategory" : fuelLoadCategory,
									"validatorFuelLoadCategory" : validatorFuelLoadCategory
								};
								obsList.push(obs);							
							},
							error : function(error) {
								return Parse.Promise.error("There was an error in finding Observations.");
							}
						}));
		            }
		    });
		    // Return a new promise that is resolved when all of the promises are resolved
		    return Parse.Promise.when(promises);
		}).then(function() {
		    response.success(obsList);
		}, function(error) {
			  response.error("Error: " + error.code + " " + error.message);
		});
	}	
});


Parse.Cloud.define("getObsForInputToVISCA", function(request, response) {
	var obsList = [];	// the output array for response
	
	/*
	 * An example of result
		
	 */

	var queryObservation = new Parse.Query("GCUR_OBSERVATION");
	queryObservation.equalTo("ObservationStatus", 0);			// Current week's observations
	queryObservation.limit(1000);
	queryObservation.include("Location");
	queryObservation.find().then(function(results) {
		
		for (var i = 0; i < results.length; i ++) {
			var locObjId = locName = locLat = locLng = undefined;
			var obsObjId = areaCuring = validatorCuring = adminCuring = bestCuring = undefined;
			var isValidated = 0;
			var equivalentFuelLoad = validatorFuelLoad = undefined;		// "EquivalentFuelLoad" is "UserFuelLoad";
			var fuelContinuity = fuelQuantity = undefined;
			
			var obs = results[i];	// "obs" is a GCUR_OBSERVATION object
			
			var location = obs.get("Location");
			locObjId = location.id;
			locName = location.get("LocationName");
			locLat = location.get("Lat");
			locLng = location.get("Lng");
			
			obsObjId = obs.id;
			
			if (obs.has("AreaCuring"))
				areaCuring = obs.get("AreaCuring");
			if (obs.has("ValidatorCuring"))
				validatorCuring = obs.get("ValidatorCuring");
			if (obs.has("AdminCuring"))
				adminCuring = obs.get("AdminCuring");
			if (obs.has("UserFuelLoad"))
				equivalentFuelLoad = obs.get("UserFuelLoad");
			if (obs.has("ValidatorFuelLoad"))
				validatorFuelLoad = obs.get("ValidatorFuelLoad");
			if (obs.has("FuelContinuity"))
				fuelContinuity = obs.get("FuelContinuity");
			if (obs.has("FuelQuantity"))
				fuelQuantity = obs.get("FuelQuantity");
			
			if (obs.has("AdminCuring")) {
				bestCuring = obs.get("AdminCuring");
			} else if (obs.has("ValidatorCuring")) {
				bestCuring = obs.get("ValidatorCuring");
			} else if (obs.has("AreaCuring")) {
				bestCuring = obs.get("AreaCuring");
			}
			
			if (obs.has("ValidatorCuring") || obs.has("AdminCuring") || obs.has("ValidatorFuelLoad"))
				isValidated = 1;
			
			var obsJSON = {
					"obsObjId" : obsObjId,
					"locObjId" : 	locObjId,
					"locName" : locName,
					"locLat": locLat,
					"locLng": locLng,
					"areaCuring" : areaCuring,
					"validatorCuring" : validatorCuring,
					"adminCuring" : adminCuring,
					"bestCuring" : bestCuring,
					"isValidated" : isValidated,
					"equivalentFuelLoad" : equivalentFuelLoad,
					"validatorFuelLoad" : validatorFuelLoad,
					"fuelContinuity" : fuelContinuity,
					"fuelQuantity" : fuelQuantity
			};
			console.log("*** " + locName + ". validatorCuring = " + validatorCuring + ". validatorFuelLoad = " + validatorFuelLoad)
			
			obsList.push(obsJSON);
			
			// Sort by locName, case-insensitive, A-Z
			obsList.sort(sort_by('locName', false, function(a){return a.toUpperCase()}));
		}
		
	}).then(function() {
	    response.success(obsList);
	}, function(error) {
		response.error("Error: " + error.code + " " + error.message);
	});
});

// Referenced by the observationDetails.jsp page object
Parse.Cloud.define("getCurrPrevSimpleObservationsForLocation", function(request, response) {
	var locObjectId = request.params.locObjectId;
	var locName = null;
	
	var queryLocation = new Parse.Query("GCUR_LOCATION");
	queryLocation.equalTo("objectId", locObjectId);
	queryLocation.first().then(function(result){
		var location = result;		
		locName = location.get("LocationName");
		locStatus = location.get("LocationStatus");
		
		var queryObservation = new Parse.Query("GCUR_OBSERVATION");
		queryObservation.equalTo("Location", location);	// By _Pointer
		queryObservation.include("Observer");
		queryObservation.include("Validator");
		queryObservation.include("Administrator");
		queryObservation.include("Location");
		queryObservation.include("RateOfDrying");
		queryObservation.limit(1000);
		queryObservation.notEqualTo("ObservationStatus", 2);	// excludes the archived observation
		queryObservation.ascending("ObservationStatus");	// this enables fetching current(0) and previous(1) observations
		
		return queryObservation.find({ useMasterKey: true });
	}, function(error) {
		response.error("GCUR_LOCATION table lookup failed");
	}).then(function(results) {
		// results are JavaScript Array of GCUR_OBSERVATION objects
		console.log("GCUR_OBSERVATION - find " + results.length + " records for GCUR_LOCATION " + locObjectId);
		
		var returnedJSON = {
				"locationObjId" : 	locObjectId,
				"locationName" : locName,
				"locationStatus" : locStatus
		};
				
		if (results.length > 0) {
			var currObservationObjectId, currObservationDate, currObserverObjectId, currObserverName;
			var currPointCuring, currPointHeight, currPointCover, currPointFuelLoad, currAreaCuring, currAreaHeight, currAreaCover, currAreaFuelLoad, currRainfall, currRodObjectId, currComment, currUserFuelLoad, currFuelLoadCategory;
			var currValidationDate, currValidatorObjectId, currValidatorName, currValidatorCuring, currValidatorFuelLoadCategory;
			var currAdminDate, currAdminObjectId, currAdminName, currAdminCuring;
			var prevObservationObjectId, prevPointCuring, prevPointHeight, prevPointCover, prevPointFuelLoad, prevAreaCuring, prevAreaHeight, prevAreaCover, prevAreaFuelLoad, prevRainfall, prevRodObjectId, prevUserFuelLoad, prevFuelLoadCategory;
			var prevOpsCuring;	// in total 35 attributes
			
			// Only previous observation exists for the Location
			if ((results.length == 1) && (results[0].get("ObservationStatus") == 1)) {
				// results[0] is GCUR_OBSERVATION for previous observation
				
				// check if FinalisedDate is 30 days away
				var isPrevObsTooOld = isObsTooOld(results[0].get("FinalisedDate"));
				if (!isPrevObsTooOld) {
					prevObservationObjectId = results[0].id;
					if (results[0].has("PointCuring"))
						prevPointCuring = results[0].get("PointCuring");
					if (results[0].has("PointHeight"))
						prevPointHeight = results[0].get("PointHeight");
					if (results[0].has("PointCover"))
						prevPointCover = results[0].get("PointCover");
					if (results[0].has("PointFuelLoad"))
						prevPointFuelLoad = results[0].get("PointFuelLoad");
					if (results[0].has("AreaCuring"))
						prevAreaCuring = results[0].get("AreaCuring");
					if (results[0].has("AreaHeight"))
						prevAreaHeight = results[0].get("AreaHeight");
					if (results[0].has("AreaCover"))
						prevAreaCover = results[0].get("AreaCover");
					if (results[0].has("AreaFuelLoad"))
						prevAreaFuelLoad = results[0].get("AreaFuelLoad");
					if (results[0].has("UserFuelLoad"))
						prevUserFuelLoad = results[0].get("UserFuelLoad");
					if (results[0].has("Rainfall"))
						prevRainfall = results[0].get("Rainfall");
					if (results[0].has("RateOfDrying")) {
						var prevRateOfDrying = results[0].get("RateOfDrying");
						prevRodObjectId = prevRateOfDrying.id;
					}
					if (results[0].has("FuelLoadCategory"))
						prevFuelLoadCategory = results[0].get("FuelLoadCategory");
					
					if (results[0].has("AdminCuring")) {
						prevOpsCuring = results[0].get("AdminCuring");
					} else if (results[0].has("ValidatorCuring")) {
						prevOpsCuring = results[0].get("ValidatorCuring");
					}
					/*
					else {
						prevOpsCuring = results[0].get("AreaCuring");
					}
					*/
				}
			} else {			
				// current observation exists
				
				// Observer's current observation details
				currObservationObjectId = results[0].id;
				if (results[0].has("ObservationDate")) {
					currObservationDate = results[0].get("ObservationDate");
				}
				if (results[0].has("Observer")) {
					var observer = results[0].get("Observer");
					currObserverObjectId = observer.id;
					//currObserverName = observer.get("username");
					currObserverName = observer.get("firstName") + " " + observer.get("lastName");
				}
				if (results[0].has("PointCuring"))
					currPointCuring = results[0].get("PointCuring");
				if (results[0].has("PointHeight"))
					currPointHeight = results[0].get("PointHeight");
				if (results[0].has("PointCover"))
					currPointCover = results[0].get("PointCover");
				if (results[0].has("PointFuelLoad"))
					currPointFuelLoad = results[0].get("PointFuelLoad");
				if (results[0].has("AreaCuring"))
					currAreaCuring = results[0].get("AreaCuring");
				if (results[0].has("AreaHeight"))
					currAreaHeight = results[0].get("AreaHeight");
				if (results[0].has("AreaCover"))
					currAreaCover = results[0].get("AreaCover");
				if (results[0].has("AreaFuelLoad"))
					currAreaFuelLoad = results[0].get("AreaFuelLoad");
				if (results[0].has("UserFuelLoad"))
					currUserFuelLoad = results[0].get("UserFuelLoad");
				if (results[0].has("Rainfall"))
					currRainfall = results[0].get("Rainfall");
				if (results[0].has("RateOfDrying")) {
					var currRateOfDrying = results[0].get("RateOfDrying");
					currRodObjectId = currRateOfDrying.id;
				}
				if (results[0].has("Comments"))
					currComment = results[0].get("Comments");
				if (results[0].has("FuelLoadCategory"))
					currFuelLoadCategory = results[0].get("FuelLoadCategory");
				
				// validator's observation details
				if (results[0].has("ValidationDate"))
					currValidationDate = results[0].get("ValidationDate");			
				if (results[0].has("Validator")) {
					var validator = results[0].get("Validator");
					currValidatorObjectId = validator.id;
					currValidatorName = validator.get("username");
				}
				if (results[0].has("ValidatorCuring"))
					currValidatorCuring = results[0].get("ValidatorCuring");
				if (results[0].has("ValidatorFuelLoadCategory"))
					currValidatorFuelLoadCategory = results[0].get("ValidatorFuelLoadCategory");
				
				// admin's observation details
				if (results[0].has("AdminDate"))
					currAdminDate = results[0].get("AdminDate");			
				if (results[0].has("Administrator")) {
					var administrator = results[0].get("Administrator");
					currAdminObjectId = administrator.id;
					currAdminName = administrator.get("username");
				}
				if (results[0].has("AdminCuring"))
					currAdminCuring = results[0].get("AdminCuring");
				
				// Previous observation does exist
				if (results.length == 2) {
					// results[1] is GCUR_OBSERVATION for previous observation
					
					// check if FinalisedDate is 30 days away
					var isPrevObsTooOld = isObsTooOld(results[1].get("FinalisedDate"));
					if (!isPrevObsTooOld) {
						prevObservationObjectId = results[1].id;
						if (results[1].has("PointCuring"))
							prevPointCuring = results[1].get("PointCuring");
						if (results[1].has("PointHeight"))
							prevPointHeight = results[1].get("PointHeight");
						if (results[1].has("PointCover"))
							prevPointCover = results[1].get("PointCover");
						if (results[1].has("PointFuelLoad"))
							prevPointFuelLoad = results[1].get("PointFuelLoad");
						if (results[1].has("AreaCuring"))
							prevAreaCuring = results[1].get("AreaCuring");
						if (results[1].has("AreaHeight"))
							prevAreaHeight = results[1].get("AreaHeight");
						if (results[1].has("AreaCover"))
							prevAreaCover = results[1].get("AreaCover");
						if (results[1].has("AreaFuelLoad"))
							prevAreaFuelLoad = results[1].get("AreaFuelLoad");
						if (results[1].has("UserFuelLoad"))
							prevUserFuelLoad = results[1].get("UserFuelLoad");
						if (results[1].has("Rainfall"))
							prevRainfall = results[1].get("Rainfall");
						if (results[1].has("RateOfDrying")) {
							var prevRateOfDrying = results[1].get("RateOfDrying");
							prevRodObjectId = prevRateOfDrying.id;
						}
						if (results[1].has("FuelLoadCategory"))
						prevFuelLoadCategory = results[1].get("FuelLoadCategory");
						
						if (results[1].has("AdminCuring")) {
							prevOpsCuring = results[1].get("AdminCuring");
						} else if (results[1].has("ValidatorCuring")) {
							prevOpsCuring = results[1].get("ValidatorCuring");
						} 
						/*
						else {
							prevOpsCuring = results[1].get("AreaCuring");
						}
						*/
					}
				}
			}
			
			// add additional observation attributes
			/**
			 * 	var currObservationObjectId, currObservationDate, currObserverObjectId, currObserverName;
				var currPointCuring, currPointHeight, currPointCover, currPointFuelLoad, currAreaCuring, currAreaHeight, currAreaCover, currAreaFuelLoad, currRainfall, currRodObjectId, currComment, currUserFuelLoad;
				var currValidationDate, currValidatorObjectId, currValidatorName, currValidatorCuring;
				var currAdminDate, currAdminObjectId, currAdminName, currAdminCuring;
				var prevObservationObjectId, prevPointCuring, prevPointHeight, prevPointCover, prevPointFuelLoad, prevAreaCuring, prevAreaHeight, prevAreaCover, prevAreaFuelLoad, prevRainfall, prevRodObjectId, prevUserFuelLoad
				var prevOpsCuring;
			 */
			
			var currPrevObsDetails = {
					"currObservationObjectId" : currObservationObjectId,
					"currObservationDate" : currObservationDate,
					"currObserverObjectId" : currObserverObjectId,
					"currObserverName" : currObserverName,
					"currPointCuring" : currPointCuring,
					"currPointHeight" : currPointHeight,
					"currPointCover" : currPointCover,
					"currPointFuelLoad" : currPointFuelLoad,
					"currAreaCuring" : currAreaCuring,
					"currAreaHeight" : currAreaHeight,
					"currAreaCover" : currAreaCover,
					"currAreaFuelLoad" : currAreaFuelLoad,
					"currUserFuelLoad" : currUserFuelLoad,
					"currRainfall" : currRainfall,
					"currRodObjectId" : currRodObjectId,
					"currComment" : currComment,
					"currFuelLoadCategory" : currFuelLoadCategory,
					"currValidationDate" : currValidationDate,
					"currValidatorObjectId" : currValidatorObjectId,
					"currValidatorName" : currValidatorName,
					"currValidatorCuring" : currValidatorCuring,
					"currValidatorFuelLoadCategory" : currValidatorFuelLoadCategory,
					"currAdminDate" : currAdminDate,
					"currAdminObjectId" : currAdminObjectId,
					"currAdminName" : currAdminName,
					"currAdminCuring" : currAdminCuring,
					"prevObservationObjectId" : prevObservationObjectId,
					"prevPointCuring" : prevPointCuring,
					"prevPointHeight" : prevPointHeight,
					"prevPointCover" : prevPointCover,
					"prevPointFuelLoad" : prevPointFuelLoad,
					"prevAreaCuring" : prevAreaCuring,
					"prevAreaHeight" : prevAreaHeight,
					"prevAreaCover" : prevAreaCover,
					"prevAreaFuelLoad" : prevAreaFuelLoad,
					"prevUserFuelLoad" : prevUserFuelLoad,
					"prevRainfall" : prevRainfall,
					"prevRodObjectId" : prevRodObjectId,
					"prevFuelLoadCategory" : prevFuelLoadCategory,
					"prevOpsCuring" : prevOpsCuring
			};
						
			returnedJSON["currPrevObsDetails"] = currPrevObsDetails;			
		}
		
		response.success(returnedJSON);
	}, function(error) {
		response.error("GCUR_OBSERVATION table lookup failed");
	});	 
});

Parse.Cloud.define("getAllFuelLoadLookupItems", function(request, response) {
	var query = new Parse.Query("GCUR_LOOKUP_FUELLOAD");
	query.limit(1000);
	query.ascending("height");
	var returnedJSON = [];
	
	query.find().then(function(results) {
		for (var i = 0; i < results.length; i++) {
			//console.log(results[i].get("height") + " -" + results[i].get("cover") + " - " + results[i].get("fuel_load"));
			var rod = {
					"height" : results[i].get("height"),
					"cover" : results[i].get("cover"),
					"fuel_load" : results[i].get("fuel_load")
			};
			
			returnedJSON.push(rod);
		}

		response.success(returnedJSON);
	}, function(error) {
	      response.error("GCUR_LOOKUP_FUELLOAD lookup failed");
	});
});

Parse.Cloud.define("getAllAdjByLocDists", function(request, response) {
	var query = new Parse.Query("GCUR_ADJUST_LOCATION_LOOKUP_DIST");
	query.limit(1000);
	query.ascending("distance");
	var returnedJSON = [];
	
	query.find().then(function(results) {
		for (var i = 0; i < results.length; i++) {
			//console.log(results[i].get("height") + " -" + results[i].get("cover") + " - " + results[i].get("fuel_load"));
			var dist = {
					"d" : results[i].get("distance")
			};
			
			returnedJSON.push(dist);
		}

		response.success(returnedJSON);
	}, function(error) {
	      response.error("GCUR_ADJUST_LOCATION_LOOKUP_DIST lookup failed");
	});
});

Parse.Cloud.define("getAllLocationsWithLinkedStatusForObservers", function(request, response) {
	var userObjectId = request.params.objectId;
	var userName = null;
	var firstName = null;
	var lastName = null;
	var allLocs = [];
	
	var query = new Parse.Query("GCUR_LOCATION");
	query.ascending("LocationName");
	query.limit(1000);
	query.find().then(function (locations) {
		console.log("All locations count: " + locations.length);
		for (var i = 0; i < locations.length; i++) {
			var loc = {
				"locationId" : locations[i].id,
				"locationName" : locations[i].get("LocationName"),
				"locationStatus" : locations[i].get("LocationStatus"),
				"linked" : false
			};
			
			allLocs.push(loc);
		}		
		
		// Find the user
		var queryUser = new Parse.Query(Parse.User);
		queryUser.equalTo("objectId", userObjectId);
		return queryUser.first({ useMasterKey: true });
	}).then(function (user) {
		  userName = user.get("username");
		  firstName = user.get("firstName");
		  lastName = user.get("lastName");
		  console.log("userName - " + userName);
		  var queryMMR = new Parse.Query("GCUR_MMR_OBSERVER_LOCATION");
		  // Include the post data with each comment
		  queryMMR.include("Observer");
		  queryMMR.include("Location");
		  queryMMR.limit(1000);
		  return queryMMR.find({ useMasterKey: true });
	}).then(function(results) {
		  var locationsForUser = null;
	      
	      for (var i = 0; i < results.length; i++) {
	        var user = results[i].get("Observer");
	        var usrObjId = user.id;
	        if (usrObjId == userObjectId) {
	        	var location = results[i].get("Location");
	            
	            for (var j = 0; j < allLocs.length; j++) {
	            	if (allLocs[j]["locationId"] == location.id) {
	            		allLocs[j]["linked"] = true;
	            		break;
	            	}
	            }
	        }
	      }
	      
	      locationsForUser = {
	        "userObjectId": userObjectId,
	        "userName": userName,
	        "firstName": firstName,
	        "lastName": lastName,
	        "locationList": allLocs
	      };
	      response.success(locationsForUser);
	  }, function(error) {
		  response.error("Error: " + error.code + " " + error.message);
	  });
	});

Parse.Cloud.define("updateLinkedLocsForObserverByIds", function(request, response) {
	var observerObjId = request.params.observerObjId;	// String
	var mmrObjsToBeRemoved = [];
	var newLinkedLocsIds = [];	// all new linked locations' Ids
	
	for (var i = 0; i < request.params.linkedLocsIds.length; i ++) {
		console.log("New linked locations for Observer [" + observerObjId + "]: " + request.params.linkedLocsIds[i]["locId"]);
		newLinkedLocsIds.push(request.params.linkedLocsIds[i]["locId"]);
	}
	
	var queryMMR = new Parse.Query("GCUR_MMR_OBSERVER_LOCATION");
	queryMMR.include("Observer");
	queryMMR.include("Location");
	queryMMR.limit(1000);
	queryMMR.find({ useMasterKey: true }).then(function(results) {
		for (var i = 0; i < results.length; i ++) {
			var user = results[i].get("Observer");
	        if (user.id == observerObjId) {
	        	mmrObjsToBeRemoved.push(results[i]);
	        }
		}
		console.log("MMR_Observer_Location to be remove [count]: " + mmrObjsToBeRemoved.length);
		
		// Remove all existing MMR records for the ObserverId
		return Parse.Object.destroyAll(mmrObjsToBeRemoved);
	}).then(function() {
		console.log("All existing MMR Observer Location records successfully deleted");
		var MMRToBeSaved = [];
		
		for (var j = 0; j < newLinkedLocsIds.length; j ++) {
			var observer = new Parse.User();
			observer.id = observerObjId;
			
			var GCUR_LOCATION = Parse.Object.extend("GCUR_LOCATION");
			var location = new GCUR_LOCATION();
			location.id = newLinkedLocsIds[j];
			
			var GCUR_MMR_OBSERVER_LOCATION = Parse.Object.extend("GCUR_MMR_OBSERVER_LOCATION");
			var mmr_obsvr_loc = new GCUR_MMR_OBSERVER_LOCATION();
			mmr_obsvr_loc.set("Observer", observer);
			mmr_obsvr_loc.set("Location", location);
			
			MMRToBeSaved.push(mmr_obsvr_loc);
		}
		
		return Parse.Object.saveAll(MMRToBeSaved, { useMasterKey: true });
	}, function(error) {
		// An error occurred while deleting one or more of the objects.
	      // If this is an aggregate error, then we can inspect each error
	      // object individually to determine the reason why a particular
	      // object was not deleted.
	      if (error.code == Parse.Error.AGGREGATE_ERROR) {
	        for (var i = 0; i < error.errors.length; i++) {
	          console.log("Couldn't delete " + error.errors[i].object.id +
	            "due to " + error.errors[i].message);
	        }
	      } else {
	        console.log("Delete aborted because of " + error.message);
	      }
	      
		response.error("Error: " + error.code + " " + error.message);
	}).then(function(objectList) {
		// all the objects were saved.
		var mmrIds = [];
		
		for (var y = 0; y < objectList.length; y ++) {
			mmrIds.push(objectList[y].id);
		}
		
		var newCreatedMMRObjIds = {
		        "mmrObjIds": mmrIds
		};
		
		response.success(newCreatedMMRObjIds);
	}, function(error) {
		response.error("Error: " + error.code + " " + error.message);
	});
});

Parse.Cloud.define("acceptAllObserverCurings", function(request, response) {
	var validatorObjId = request.params.validatorObjId;	// String
	
	console.log("*** acceptAllObserverCurings function called by Validator [" + validatorObjId + "]");
	
	var sessionToken = undefined;
	if (request.user != undefined) {
		sessionToken = request.user.getSessionToken();
		console.log("* request.user.id = " + request.user.id);
	}
	
	var queryObservation = new Parse.Query("GCUR_OBSERVATION");
	queryObservation.equalTo("ObservationStatus", 0);	// All current observation records
	queryObservation.greaterThanOrEqualTo("AreaCuring", 0);
	queryObservation.limit(1000);
	queryObservation.find().then(function(results) {
		var affectedObsCount = 0;
		
		for (var i = 0; i < results.length; i ++) {
			var obs = results[i];
			
			var areaCuring = obs.get("AreaCuring");
			var currDateTime = new Date();
			var validator = new Parse.User();
			validator.id = validatorObjId;
			
			obs.set("ValidatorCuring", areaCuring);
			obs.set("ValidationDate", currDateTime);
			obs.set("Validator", validator);
			//obs.save();
			
			affectedObsCount = affectedObsCount + 1;
		}
		
		Parse.Object.saveAll(results, {
			sessionToken: sessionToken,
		    success: function(list) {
		        // All the objects were saved.
		    	response.success(affectedObsCount);  //saveAll is now finished and we can properly exit with confidence :-)
		      },
		      error: function(error) {
		        // An error occurred while saving one of the objects.
		    	  response.error("Error: " + error.code + " " + error.message);
		      },
		    });
		
		//response.success(results.length);
	}, function(error) {
		response.error("Error: " + error.code + " " + error.message);
	});
});

Parse.Cloud.define("getAdjustedCuringForAllDistricts", function(request, response) {
	var status = request.params.status;	// "status" = 0 (current), or = 1 (previous)
	var distAdjustedCuringList = [];	// the output array for response

	var queryDistrict = new Parse.Query("GCUR_DISTRICT");
	queryDistrict.ascending("DISTRICT");
	queryDistrict.limit(1000);
	queryDistrict.find().then(function(results) {
		// Create a trivial resolved promise as a base case.
	    var promises = [];
	    // each result is a GCUR_DISTRICT row
	    _.each(results, function(result) {
	    	var gcur_district = result;
	    	var districtObjId = gcur_district.id;
	    	var districtNo = gcur_district.get("DISTRICT");
	    	var districtName = gcur_district.get("DIST_NAME");
	    	
	    	var distAdjustedCuringObj = null;
	    	
	    	var queryAdjustDistrict = new Parse.Query("GCUR_ADJUST_DISTRICT");
	    	queryAdjustDistrict.ascending("district");
	    	queryAdjustDistrict.equalTo("district", districtNo);
	    	queryAdjustDistrict.equalTo("status", status);		// status is user-specific, so it can be either current week or previous week
	    	queryAdjustDistrict.limit(1000);
	    	
	    	promises.push(queryAdjustDistrict.find({
				success : function(results) {
					// results are JavaScript Array of GCUR_ADJUST_DISTRICT objects;
					// the length can only be either 0 or 1;
					var thisDistrict, adjustedCuring, thisStatus, adjustDistrictObjId;
					
					if (results.length > 0) {
						// The DISTRICT has an adjustedCuring and status record in GCUR_ADJUST_DISTRICT
						adjustDistrictObjId = results[0].id;
						thisDistrict = results[0].get("district");
						adjustedCuring = results[0].get("adjustedCuring");
						thisStatus = results[0].get("status");
					} else {
						// The DISTRICT does not have an adjustedCuring and status
						adjustDistrictObjId = "";
						thisDistrict = districtNo;
						adjustedCuring = NULL_VAL_INT;
						thisStatus = status;
					}
					
					//
					distAdjustedCuringObj = {
						"adjustDistrictObjId": adjustDistrictObjId,
						"districtNo": thisDistrict,
						"districtName": districtName,
						"adjustedCuring": adjustedCuring,
						"status": thisStatus
					};
					distAdjustedCuringList.push(distAdjustedCuringObj);
				},
				error : function(error) {
					return Parse.Promise.error("There was an error in finding GCUR_ADJUST_DISTRICTs.");
				}
			}));
	    });
	    
	    // Return a new promise that is resolved when all of the promises are resolved
	    return Parse.Promise.when(promises);
	}).then(function() {
	    response.success(distAdjustedCuringList);
	}, function(error) {
		response.error("Error: " + error.code + " " + error.message);
	});
});

Parse.Cloud.define("createUpdateCurrGCURAdjustDistrict", function(request, response) {
	
	/*
	 * An example of request parameter
	 * {"newAdjustByDistrictObjs":[
	 * 	{"status":0,"adjustedCuring":20,"district":2},
	 * 	{"status":0,"adjustedCuring":40,"district":4},
	 * 	{"status":0,"adjustedCuring":60,"district":6}]
	 * }
	 */
	
	var newAdjustByDistrictObjs = request.params.newAdjustByDistrictObjs;
	
	// Remove all the existing current GCUR_ADJUST_DISTRICT records from the GCUR_ADJUST_DISTRICT class
	var queryDistrict = new Parse.Query("GCUR_ADJUST_DISTRICT");
	queryDistrict.limit(1000);
	queryDistrict.equalTo("status", 0);	// All current GCUR_ADJUST_DISTRICT records
	queryDistrict.find().then(function(results) {
		
		// Do remove about all current GCUR_ADJUST_DISTRICT records
		return Parse.Object.destroyAll(results);
	}).then(function() {
		console.log("All current GCUR_ADJUST_DISTRICT (status = 0) records have been successfully deleted");
		
		var AdjustDistrictsToBeSaved = [];
		
		for (var j = 0; j < newAdjustByDistrictObjs.length; j ++) {
			var district = newAdjustByDistrictObjs[j]["district"];
			var adjustedCuring = newAdjustByDistrictObjs[j]["adjustedCuring"];
			var status = newAdjustByDistrictObjs[j]["status"];
			
			console.log("New AdjustByDistrict - [" + district + "]: " + adjustedCuring + ", " + status);
			
			var GCUR_ADJUST_DISTRICT = Parse.Object.extend("GCUR_ADJUST_DISTRICT");
			var newAdjustDistrict = new GCUR_ADJUST_DISTRICT();
			newAdjustDistrict.set("district", district);
			newAdjustDistrict.set("adjustedCuring", adjustedCuring);
			newAdjustDistrict.set("status", status);
			
			AdjustDistrictsToBeSaved.push(newAdjustDistrict);
		}
		
		return Parse.Object.saveAll(AdjustDistrictsToBeSaved);
	}, function(error) {
		// ERROR ON destroyAll()
		// An error occurred while deleting one or more of the objects.
	      // If this is an aggregate error, then we can inspect each error
	      // object individually to determine the reason why a particular
	      // object was not deleted.
	      if (error.code == Parse.Error.AGGREGATE_ERROR) {
	        for (var i = 0; i < error.errors.length; i++) {
	          console.log("Couldn't delete " + error.errors[i].object.id +
	            "due to " + error.errors[i].message);
	        }
	      } else {
	        console.log("Delete aborted because of " + error.message);
	      }
	      
		response.error("Error: " + error.code + " " + error.message);
	}).then(function(objectList) {
		// all the new GCUR_ADJUST_DISTRICT objects were saved.
		var newAdjustDistrictIds = [];
		
		for (var y = 0; y < objectList.length; y ++) {
			newAdjustDistrictIds.push(objectList[y].id);
		}
		
		var createdAdjustDistrictIds = {
		        "createdAdjustDistrictIds": newAdjustDistrictIds
		};
		
		response.success(createdAdjustDistrictIds);
	}, function(error) {
		response.error("Error: " + error.code + " " + error.message);
	});
});

Parse.Cloud.define("getAdjustedCuringForLocations", function(request, response) {
	var status = request.params.status;	// "status" = 0 (current), or = 1 (previous)
	var locAdjustedCuringList = [];	// the output array for response

	var queryAdjustLoc = new Parse.Query("GCUR_ADJUST_LOCATION");
	queryAdjustLoc.ascending("location");
	queryAdjustLoc.equalTo("status", status);		// status is user-specific, so it can be either current week or previous week
	queryAdjustLoc.limit(1000);
	queryAdjustLoc.include("location");
	
	queryAdjustLoc.find().then(function(results) {
		for (var i = 0; i < results.length; i ++) {
			var adjustByLoc = results[i];
			
			var location = adjustByLoc.get("location");
			var locationId = location.id;
			var locationName = location.get("LocationName");
			
			var adjustedCuring = adjustByLoc.get("adjustedCuring");
			
			var adjustedDistance = adjustByLoc.get("adjustedDistance");
			
			//var status = adjustByLoc.get("status");
			
			locAdjustedCuringObj = {
					"locObjId": locationId,
					"locName": locationName,
					"adjustedCuring": adjustedCuring,
					"adjustedDistance": adjustedDistance
			};
			
			locAdjustedCuringList.push(locAdjustedCuringObj);
		}
	}).then(function() {
	    response.success(locAdjustedCuringList);
	}, function(error) {
		response.error("Error: " + error.code + " " + error.message);
	});
	
});

Parse.Cloud.define("createUpdateCurrGCURAdjustLocation", function(request, response) {
	
	/*
	 * An example of request parameter
	 * {"newAdjustByLocationObjs":[
	 * 	{"status":0,"adjustedCuring":100,"adjustedDistance":24,"locObjId":"kgQ8puq5lC"},
	 * 	{"status":0,"adjustedCuring":90,"adjustedDistance":48,"locObjId":"ZuYu1Neenj"},
	 * 	{"status":0,"adjustedCuring":60,"adjustedDistance":72,"locObjId":"CvyfGSYArB"}]
	 * }
	 */
	
	var newAdjustByLocationObjs = request.params.newAdjustByLocationObjs;
	
	// Remove all the existing current GCUR_ADJUST_LOCATION records from the GCUR_ADJUST_LOCATION class
	var queryLocation = new Parse.Query("GCUR_ADJUST_LOCATION");
	queryLocation.limit(1000);
	queryLocation.equalTo("status", 0);	// All current GCUR_ADJUST_LOCATION records
	queryLocation.find().then(function(results) {
		
		// Do remove about all current GCUR_ADJUST_LOCATION records
		return Parse.Object.destroyAll(results);
	}).then(function() {
		console.log("All current GCUR_ADJUST_LOCATION (status = 0) records have been successfully deleted");
		
		var AdjustLocationsToBeSaved = [];
		
		for (var j = 0; j < newAdjustByLocationObjs.length; j ++) {
			var locObjId = newAdjustByLocationObjs[j]["locObjId"];
			var adjustedCuring = newAdjustByLocationObjs[j]["adjustedCuring"];
			var adjustedDistance = newAdjustByLocationObjs[j]["adjustedDistance"];
			var status = newAdjustByLocationObjs[j]["status"];
			
			console.log("New AdjustByLocation to be added - [" + locObjId + "]: " + adjustedCuring + ", " + adjustedDistance + ", " + status);
			
			var GCUR_LOCATION = Parse.Object.extend("GCUR_LOCATION");
			var location = new GCUR_LOCATION();
			location.id = locObjId;
			
			var GCUR_ADJUST_LOCATION = Parse.Object.extend("GCUR_ADJUST_LOCATION");
			var newAdjustLocation = new GCUR_ADJUST_LOCATION();
			newAdjustLocation.set("location", location);
			newAdjustLocation.set("adjustedCuring", adjustedCuring);
			newAdjustLocation.set("adjustedDistance", adjustedDistance);
			newAdjustLocation.set("status", status);
			
			AdjustLocationsToBeSaved.push(newAdjustLocation);
		}
		
		return Parse.Object.saveAll(AdjustLocationsToBeSaved);
	}, function(error) {
		// ERROR ON destroyAll()
		// An error occurred while deleting one or more of the objects.
	      // If this is an aggregate error, then we can inspect each error
	      // object individually to determine the reason why a particular
	      // object was not deleted.
	      if (error.code == Parse.Error.AGGREGATE_ERROR) {
	        for (var i = 0; i < error.errors.length; i++) {
	          console.log("Couldn't delete " + error.errors[i].object.id +
	            "due to " + error.errors[i].message);
	        }
	      } else {
	        console.log("Delete aborted because of " + error.message);
	      }
	      
		response.error("Error: " + error.code + " " + error.message);
	}).then(function(objectList) {
		// all the new GCUR_ADJUST_LOCATION objects were saved.
		var newAdjustLocationIds = [];
		
		for (var y = 0; y < objectList.length; y ++) {
			newAdjustLocationIds.push(objectList[y].id);
		}
		
		var createdAdjustLocationIds = {
				"createdAdjustLocationIds": newAdjustLocationIds
		};
		
		response.success(createdAdjustLocationIds);
	}, function(error) {
		response.error("Error: " + error.code + " " + error.message);
	});
});

/**
 * Finalise all data on the Parse.com side. This function is called in FinaliseModel python script
 * - Finalise GCUR_OBSERVATION class
 * - Finalise GCUR_ADJUST_DISTRICT class
 * - Finalise GCUR_ADJUST_LOCATION class
 */
Parse.Cloud.define("finaliseDataOnParse", function(request, response) {
	var result = false;
	
	console.log("Triggering the Cloud Function 'finaliseDataOnParse'");
	
	// Change all GCUR_OBSERVATION records with ObservationStatus being 1 to 2
	queryPrev = new Parse.Query("GCUR_OBSERVATION");
	queryPrev.equalTo("ObservationStatus", 1);
	queryPrev.limit(1000);
	queryPrev.find().then(function(prev_observations) {
		//return Parse.Object.destroyAll(prev_observations);
		for (var i = 0; i < prev_observations.length; i ++) {
			var obs = prev_observations[i];
			obs.set("ObservationStatus", 2);
		}
		
		return Parse.Object.saveAll(prev_observations, { useMasterKey: true });
	}).then(function() {
		console.log("All GCUR_OBSERVATION records with ObservationStatus being 1 have been succssfully changed to archived observations.");
		
		// Find all current GCUR_OBSERVATION records with ObservationStatus being 0
		queryCurr = new Parse.Query("GCUR_OBSERVATION");
		queryCurr.equalTo("ObservationStatus", 0);
		queryCurr.limit(1000);
		return queryCurr.find();
	}).then(function(curr_observations) {
		for (var i = 0; i < curr_observations.length; i ++) {
			var obs = curr_observations[i];
			
			// Set current to previous
			obs.set("ObservationStatus", 1);
			
			// Set finalisedDate
			var currDateTime = new Date();
			obs.set("FinalisedDate", currDateTime);
		}
		return Parse.Object.saveAll(curr_observations, { useMasterKey: true });
	}).then(function(list) {
		// All the objects were saved.
		console.log("All current GCUR_OBSERVATION records with ObservationStatus being 0 have been succssfully updated to previous records.");
		
		// Change all GCUR_ADJUST_DISTRICT records with status being 1 to 2
		queryPrev = new Parse.Query("GCUR_ADJUST_DISTRICT");
		queryPrev.equalTo("status", 1);
		queryPrev.limit(1000);
		return queryPrev.find();
	}).then(function(prev_adjustDistricts) {
		for (var i = 0; i < prev_adjustDistricts.length; i ++) {
			var abd = prev_adjustDistricts[i];
			abd.set("status", 2);
		}
		return Parse.Object.saveAll(prev_adjustDistricts, { useMasterKey: true });
	}).then(function() {
		console.log("All GCUR_ADJUST_DISTRICT records with status being 1 have been succssfully changed to archived records.");
		
		// Find all current GCUR_ADJUST_DISTRICT records with status being 0
		queryCurr = new Parse.Query("GCUR_ADJUST_DISTRICT");
		queryCurr.equalTo("status", 0);
		queryCurr.limit(1000);
		return queryCurr.find();
	}).then(function(curr_adjustDistricts) {
		for (var i = 0; i < curr_adjustDistricts.length; i ++) {
			var abd = curr_adjustDistricts[i];
			
			// Set current to previous
			abd.set("status", 1);
		}
		return Parse.Object.saveAll(curr_adjustDistricts, { useMasterKey: true });
	}).then(function(list) {
		console.log("All current GCUR_ADJUST_DISTRICT records with ObservationStatus being 0 have been succssfully updated to previous records.");
		
		// Change all GCUR_ADJUST_LOCATION records with status being 1 to 2
		queryPrev = new Parse.Query("GCUR_ADJUST_LOCATION");
		queryPrev.equalTo("status", 1);
		queryPrev.limit(1000);
		return queryPrev.find();
	}).then(function(prev_adjustLocations) {
		for (var i = 0; i < prev_adjustLocations.length; i ++) {
			var abl = prev_adjustLocations[i];
			abl.set("status", 2);
		}
		return Parse.Object.saveAll(prev_adjustLocations, { useMasterKey: true });
	}).then(function() {
		console.log("All GCUR_ADJUST_LOCATION records with status being 1 have been succssfully changed to archived records.");
		
		// Find all current GCUR_ADJUST_LOCATION records with status being 0
		queryCurr = new Parse.Query("GCUR_ADJUST_LOCATION");
		queryCurr.equalTo("status", 0);
		queryCurr.limit(1000);
		return queryCurr.find();
	}).then(function(curr_adjustLocations) {
		for (var i = 0; i < curr_adjustLocations.length; i ++) {
			var abl = curr_adjustLocations[i];
			
			// Set current to previous
			abl.set("status", 1);
		}
		return Parse.Object.saveAll(curr_adjustLocations, { useMasterKey: true });
	}).then(function(list) {
		// All the objects were saved.
		console.log("All current GCUR_ADJUST_LOCATION records with ObservationStatus being 0 have been succssfully updated to previous records.");
		
		result = true;
		response.success(result);  //saveAll is now finished and we can properly exit with confidence :-)
	}, function(error) {
		response.error("Error: " + error.code + " " + error.message);
	});
});

/**
 * Retrieve all Finalise Date based on the "createdAt" column of the GCUR_FINALISEMODEL class
 */
Parse.Cloud.define("getAllFinalisedDate", function(request, response) {
	var finaliseModelList = [];
	
	var queryFinaliseModel = new Parse.Query("GCUR_FINALISEMODEL");
	queryFinaliseModel.ascending("createdAt");
	queryFinaliseModel.equalTo("jobResult", true);
	queryFinaliseModel.select("jobResult");
	queryFinaliseModel.limit(1000);
	
	queryFinaliseModel.find().then(function(results) {
		for (var i = 0; i < results.length; i ++) {
			var finaliseModel = results[i];
			
			var jobResult = finaliseModel.get("jobResult");
			var jobId = finaliseModel.id;
			var createdDate = finaliseModel.createdAt;
			
			var finaliseModelObj = {
					"jobId": jobId,
					"jobResult": jobResult,
					"createdDate": createdDate
			};
			
			finaliseModelList.push(finaliseModelObj);
		}
	}).then(function() {
	    response.success(finaliseModelList);
	}, function(error) {
		response.error("Error: " + error.code + " " + error.message);
	});
});

/**
 * Get the downloadable observation report based on user-specified finalised model objectId
 */
Parse.Cloud.define("getDataReport", function(request, response) {
	var finalisedModelObjectId = request.params.finalisedModelObjectId;
	
	// Query the GCUR_DISTRICT document and retrieve all district id and name sets
	var allDistrictDict = {};
	
	// Query the GCUR_LOCATION document
	var allLocations = [];
	
	var locObjIdsWithObsOrVal = [];
	
	var returnedObsList = [];
	
	var queryDistrict = new Parse.Query("GCUR_DISTRICT");
	queryDistrict.ascending("DISTRICT");
	queryDistrict.find().then(function(districts) {
		for (var i = 0; i < districts.length; i++) {
			var dist = districts[i];
			
			allDistrictDict[dist.get("DISTRICT").toString()] = dist.get("DIST_NAME");	// {1: "Brisbane", 2: "South Western", ... ...}
		}
		
		request.log.info("All " + Object.keys(allDistrictDict).length + " districts were retrieved.");
		return Parse.Promise.as("All " + Object.keys(allDistrictDict).length + " districts were retrieved.");
	}).then(function() {
		var queryLocation = new Parse.Query("GCUR_LOCATION");
		queryLocation.equalTo("LocationStatus", "mandatory");
		queryLocation.ascending("DistrictNo");
		queryLocation.limit(1000); 		// limit to at most 1000 results
		return queryLocation.find();
	}).then(function(locations) {
		for (var i = 0; i < locations.length; i++) {
			var location = locations[i];
			var locationObjectId = location.id;
			var locationName = location.get("LocationName");
			var lng = location.get("Lng");
			var lat = location.get("Lat");
			var locationStatus = location.get("LocationStatus");
			var districtNo = location.get("DistrictNo");	// district Id
			var districtName = allDistrictDict[districtNo];	// get district name from the dictionary
			
			var locObj = {
				"locationObjectId": locationObjectId,
				"locationName": locationName,
				"lng": lng,
				"lat": lat,
				"locationStatus": locationStatus,
				"districtName": districtName
			};
			
			allLocations.push(locObj);
		}
		
		request.log.info("All " + allLocations.length + " locations were retrieved.");
		return Parse.Promise.as("All " + allLocations.length + " locations were retrieved.");
	}).then(function() {
		var queryFinaliseModel = new Parse.Query("GCUR_FINALISEMODEL");
		queryFinaliseModel.equalTo("objectId", finalisedModelObjectId);
		queryFinaliseModel.limit(1000);
		return queryFinaliseModel.first();
	}).then(function(finalisedModel) {
		var createdAt = finalisedModel.createdAt;
		
		var year = createdAt.getFullYear();
		var month = createdAt.getMonth();
		var date = createdAt.getDate();
		
		// Get all observations with FinalisedDate ranging between startUTC and endUTC time period
		var startUTC = new Date(Date.UTC(year, month, date, 0, 0, 0));
		var endUTC = new Date(Date.UTC(year, month, date, 23, 59, 59));
		
		queryObservation = new Parse.Query("GCUR_OBSERVATION");
		queryObservation.greaterThan("FinalisedDate", startUTC);
		queryObservation.lessThan("FinalisedDate", endUTC);
		queryObservation.include("Location");
		queryObservation.include("RateOfDrying");
		queryObservation.limit(1000);
		return queryObservation.find();
	}).then(function(observations) {
		for (var i = 0; i < observations.length; i ++) {			
			var observationObjectId = undefined;
			var locationObjectId = undefined;
			var location = undefined;
			var locationName = undefined;
			var locationStatus = undefined;
			var lng = undefined;
			var lat = undefined;
			var districtNo = undefined;
			var districtName = undefined;
			var areaCuring = undefined;
			var areaHeight = undefined;
			var areaCover = undefined;
			var areaFuelLoad = undefined;
			var userFuelLoad = undefined;
			var validatorCuring = undefined;
			var adminCuring = undefined;
			var rainfall = undefined;
			var rateOfDrying = undefined;
			var comments = undefined;
			
			observationObjectId = observations[i].id;
			location = observations[i].get("Location");
			locationObjectId = location.id;
			locationName = location.get("LocationName");
			locationStatus = location.get("LocationStatus");
			lng = location.get("Lng");
			lat = location.get("Lat");
			districtNo = location.get("DistrictNo");		// district Id
			districtName = allDistrictDict[districtNo];		// retrieve the district name from the dictionary
			
			locObjIdsWithObsOrVal.push(locationObjectId);	// Add objectId to the locObjIdsWithObsOrVal list for later processing
			
			if (observations[i].has("AreaCuring"))
				areaCuring = observations[i].get("AreaCuring");
			if (observations[i].has("AreaHeight"))
				areaHeight = observations[i].get("AreaHeight");
			if (observations[i].has("AreaCover"))
				areaCover = observations[i].get("AreaCover");
			if (observations[i].has("AreaFuelLoad"))
				areaFuelLoad = observations[i].get("AreaFuelLoad");
			if (observations[i].has("UserFuelLoad"))
				userFuelLoad = observations[i].get("UserFuelLoad");
			
			if (observations[i].has("ValidatorCuring"))
				validatorCuring = observations[i].get("ValidatorCuring");
			if (observations[i].has("AdminCuring"))
				adminCuring = observations[i].get("AdminCuring");
			
			if (observations[i].has("Rainfall"))
				rainfall =  observations[i].get("Rainfall");
			if (observations[i].has("RateOfDrying"))
				rateOfDrying = observations[i].get("RateOfDrying").get("rateOfDrying");
			if (observations[i].has("Comments"))
				comments = observations[i].get("Comments");
			
			// 17 key-value pairs
			var returnedObs = {
					"observationObjectId": observationObjectId,
					"locationObjectId": locationObjectId,
					"locationName": locationName,
					"locationStatus": locationStatus,
					"lng": lng,
					"lat": lat,
					"districtName": districtName,
					"areaCuring": areaCuring,
					"areaHeight": areaHeight,
					"areaCover": areaCover,
					"areaFuelLoad": areaFuelLoad,
					"userFuelLoad": userFuelLoad,
					"validatorCuring": validatorCuring,
					"adminCuring": adminCuring,					
					"rainfall": rainfall,
					"rateOfDrying": rateOfDrying,
					"comments": comments
			};
			returnedObsList.push(returnedObs);
		}
		
		// Get a list of locations that had not received observations or validations;
		// those locations are to be added to the exported data report with NIL observation
		request.log.info("Count of locations observed or validated " + locObjIdsWithObsOrVal.length);
		var locationsNotObsOrVal = allLocations.filter(loc => !(locObjIdsWithObsOrVal.includes(loc["locationObjectId"])));
		request.log.info("Count of locations not observed or validated " + locationsNotObsOrVal.length);
		
		for(var k = 0; k < locationsNotObsOrVal.length; k ++) {
			var locNotObsOrVal = locationsNotObsOrVal[k];
			var returnedObs = {
					"observationObjectId": undefined,
					"locationObjectId": locNotObsOrVal["locationObjectId"],
					"locationName": locNotObsOrVal["locationName"],
					"locationStatus": locNotObsOrVal["locationStatus"],
					"lng": locNotObsOrVal["lng"],
					"lat": locNotObsOrVal["lat"],
					"districtName": locNotObsOrVal["districtName"],
					"areaCuring": undefined,
					"areaHeight": undefined,
					"areaCover": undefined,
					"areaFuelLoad": undefined,
					"userFuelLoad": undefined,
					"validatorCuring": undefined,
					"adminCuring": undefined,					
					"rainfall": undefined,
					"rateOfDrying": undefined,
					"comments": undefined
			};
			
			returnedObsList.push(returnedObs);
		}
		
		request.log.info("Count of returned observation records is " + returnedObsList.length);
	    response.success(returnedObsList);
	}, function(error) {
		response.error("Error: " + error.code + " " + error.message);
	});
});

/**
 * Get the most recent observations as downloadable observation report by the user-specified Date;
 * This was designed for sharing observations across different jurisdictions.
 */
Parse.Cloud.define("getMostRecentDataReportByDate", function(request, response) {
	
});

/**
 * Retrieve the detail about a FinaliseModel object by its input objectId
 */
Parse.Cloud.define("getFinaliseModelDetail", function(request, response) {
	var inFinaliseModelObjId = null;
	
	console.log("Getting FinaliseModel Detail for ObjectId [" + request.params.finaliseModelObjId + "]");
	inFinaliseModelObjId = request.params.finaliseModelObjId;
	
	// Query GCUR_FINALISEMODEL class
	var queryFinaliseModel = new Parse.Query("GCUR_FINALISEMODEL");
	queryFinaliseModel.equalTo("objectId", inFinaliseModelObjId);
	queryFinaliseModel.include("submittedBy");	// Retrieve _USER
	queryFinaliseModel.limit(1000);
	queryFinaliseModel.first({ useMasterKey: true }).then(function(finaliseModelJob) {
		var jobDetail = {};
		
		if (finaliseModelJob != undefined) {
			var objectId = finaliseModelJob.id;
			var createdAt = finaliseModelJob.createdAt;
			var updatedAt = finaliseModelJob.updatedAt;
			var jobResult = finaliseModelJob.get("jobResult");
			var jobResultDetails = finaliseModelJob.get("jobResultDetails");
			var status = finaliseModelJob.get("status");
			var viscaMapFile = finaliseModelJob.get("viscaMapFile");
				
			var submittedBy = finaliseModelJob.get("submittedBy");
			var userObjId = submittedBy.id;
			var firstname = submittedBy.get("firstName");
			var lastname = submittedBy.get("lastName");
		        
			jobDetail = {
		    		"objectId" : objectId,
		        	"createdAt" : createdAt,
		        	"updatedAt" : updatedAt,
		        	"jobResult" : jobResult,
		        	"jobResultDetails" : jobResultDetails,
		        	"status" : status,
		        	"viscaMapFile" : viscaMapFile,
		        	"submittedByUserOID" : userObjId,
		        	"submittedByUserFullName" : firstname + " " + lastname
		    };
		}
		
		return response.success(jobDetail);
	}, function(error) {
		response.error("Error: " + error.code + " " + error.message);
	});
});

/**
 * Apply Validation By Exception if previous best curing reached 100%
 */
Parse.Cloud.define("applyValidationByException", function(request, response) {
	var startTime = new Date().getTime();
	
	var isValidationByException = false;
	var countOfObsApplied = 0;
	
	// Check if the system setting "isValidationByException " is currently set "True";
	var querySystemSettings = new Parse.Query("GCUR_SYSTEM_SETTINGS");
	querySystemSettings.first().then(function(systemSettingRecord) {
		try {
			isValidationByException = systemSettingRecord.get("isValidationByException");
			return Parse.Promise.as("isValidationByException is found!");
		} catch (err) {
			console.log("There was an error in getting 'isValidationByException'.");
			return Parse.Promise.error("There was an error in getting 'isValidationByException'.");
		}
	}, function(error) {
		console.log("There was an error in finding GCUR_SYSTEM_SETTINGS.");
		return Parse.Promise.error("There was an error in finding GCUR_SYSTEM_SETTINGS.");
	}).then(function() {
		console.log("isValidationByException = " + isValidationByException);
		
		if (isValidationByException) {
			return Parse.Promise.as("To apply Validation By Exception rule!");
		} else {
			console.log("Not to applying Validation By Exception rule. Function stopped here.");
			return Parse.Promise.error("Validation By Exception is currently set False.");
		}
	}).then(function() {
		console.log("Applying Validation By Exception rule... ...");
		
		// retrieve previous and current observations
		var queryObservation = new Parse.Query("GCUR_OBSERVATION");
		queryObservation.include("Location");
		queryObservation.include("Observer");
		queryObservation.include("Validator");
		queryObservation.include("Administrator");
		queryObservation.limit(1000);
		queryObservation.notEqualTo("ObservationStatus", 2);	// only includes previous and current observations
		queryObservation.ascending("ObservationStatus");		// 0 - current; 1 - previous
		return queryObservation.find({ useMasterKey: true });
	}).then(function(results) {
		// results are JavaScript Array of GCUR_OBSERVATION objects for both current and previous weeks;
		
		var prevObsList = [];		// previous GCUR_OBSERVATION object array
		var prevLocIds = [];		// the objectId array for the GCUR_LOCATION objects that exist in previous GCUR_OBSERVATION objects
		var currLocIds = [];		// the objectId array for the GCUR_LOCATION objects that exist in current GCUR_OBSERVATION objects
		var prevLocsOnlyIds = [];	// the objectId array for the GCUR_LOCATION objects exist in previous GCUR_OBSERVATION objects ONLY
		
		for (var i = 0; i < results.length; i++) {
			var obsStatus = results[i].get("ObservationStatus");
			var locObjId = results[i].get("Location").id;
			
			if (results[i].get("ObservationStatus") == 1) {
				
				// check if FinalisedDate is 30 days away
				var isPrevObsTooOld = isObsTooOld(results[i].get("FinalisedDate"));
				if (!isPrevObsTooOld) {
					prevObsList.push(results[i]);
					prevLocIds.push(locObjId);
				}
			} else {
				currLocIds.push(locObjId);
			}
		}
		
		prevLocsOnlyIds = inAButNotInB(prevLocIds, currLocIds);
		console.log(prevLocsOnlyIds.length + " locations that do not exist in current week but in previous week.");
		
		//console.log("prevObs count: " + prevObs.length);
		//console.log("prevLocIds count: " + prevLocIds.length);
		//console.log("currLocIds count: " + currLocIds.length);
		
		var currObsListToBeSaved = [];	// array for the GCUR_OBSERVATION objects to be saved to the GCUR_OBSERVATION table by the rule!

		for (var j = 0; j < prevLocsOnlyIds.length; j++) {
			var currAreaCuring;
			var currValidatorCuring;
			var currAdminCuring;
			
			for (var k = 0; k < prevObsList.length; k++) {
				var prevObs = prevObsList[k];
				
				// We only care about locations that were observed in previous week but not the current week!!!
				if (prevLocsOnlyIds[j] == prevObs.get("Location").id) {
					// if does not exist, it is "undefined"
					var isToAdd = false;	// a boolean variable to indicate whether to add this GCUR_OBSERVATION object to the class
					
					var GCUR_OBSERVATION = Parse.Object.extend("GCUR_OBSERVATION");
					var currObs = new GCUR_OBSERVATION();	// a current GCUR_OBSERVATION object to be saved
					
					// Calcuate the previous best curing
					var prevOpsCuring;
					if (prevObs.has("AdminCuring")) {
						prevOpsCuring = prevObs.get("AdminCuring");
					} else if (prevObs.has("ValidatorCuring")) {
						prevOpsCuring = prevObs.get("ValidatorCuring");
					} else {
						prevOpsCuring = prevObs.get("AreaCuring");
					}
					
					// if previous best curing was not 100, do not apply automated curing
					if (prevOpsCuring != 100)
						isToAdd = false;
					else {
						isToAdd = true;
						
						// if previous AdminCuring was 100, copy to the current week GCUR_OBSERVATION record
						if (prevObs.has("AdminCuring")) {
							currObs.set("AdminCuring", prevObs.get("AdminCuring"));
							currObs.set("Administrator", prevObs.get("Administrator"));
							currObs.set("AdminDate", prevObs.get("AdminDate"));
						}
						
						// if previous ValidatorCuring exists and was 100
						if (prevObs.has("ValidatorCuring") && (prevObs.get("ValidatorCuring") == 100)) {
							currObs.set("ValidatorCuring", prevObs.get("ValidatorCuring"));
							currObs.set("Validator", prevObs.get("Validator"));
							currObs.set("ValidationDate", prevObs.get("ValidationDate"));
						}
						
						// if previous AreaCuring exists and was 100
						if (prevObs.has("AreaCuring") && (prevObs.get("AreaCuring") == 100)) {
							currObs.set("AreaCuring", prevObs.get("AreaCuring"));
							currObs.set("Observer", prevObs.get("Observer"));
							currObs.set("ObservationDate", prevObs.get("ObservationDate"));
						}
					}
					
					// add this current GCUR_OBSERVATION object to the array to be saved to the GCUR_OBSERVATION class
					if (isToAdd) {
						var location = prevObs.get("Location");
						var locationName = location.get("LocationName")
						
						currObs.set("Location", location);
						currObs.set("ObservationStatus", 0);
						currObs.set("Comments", "AutomatedValidation rule applied");
						
						currObsListToBeSaved.push(currObs);
						countOfObsApplied++;
						console.log("** Appending No. " + countOfObsApplied + " GCUR_OBSERVATION with GCUR_LOCATION objectId: " + location.id + " (" + locationName + ") from previous GCUR_OBSERVATION objectId: " + prevObs.id);
					}
					
					// remove this previous obs from the prevObsList to reduce the iteration count for the next loop
					var index = prevObsList.indexOf(prevObs);	// <-- Not supported in <IE9
					if (index !== -1) {
						prevObsList.splice(index, 1);
					}
					
					break;
				}
			}
		}
		
		return Parse.Object.saveAll(currObsListToBeSaved);
		
		//response.success(true);
	}).then(function(objectList) {
		// all the objects were saved.
		var createdNewObsIds = [];
		
		for (var y = 0; y < objectList.length; y ++) {
			createdNewObsIds.push(objectList[y].id);
		}
		
		var createdNewObsIdList = {
		        "createdNewObsIds": createdNewObsIds
		};
		
		console.log("Validation By Exception rule applied; New GCUR_OBSERVATION object count = " + countOfObsApplied);
		console.log("The execution time for 'applyValidationByException' = " + (new Date().getTime() - startTime)/1000);
		
		response.success(createdNewObsIdList);
	}, function(error) {
		response.error("Error: " + error);
	});
});

/*
Parse.Cloud.define("finaliseAdjustByDistAndLocOnParse", function(request, response) {
	Parse.Cloud.useMasterKey();
	
	// Change all GCUR_ADJUST_DISTRICT records with status being 1 to 2
	queryPrev = new Parse.Query("GCUR_ADJUST_DISTRICT");
	queryPrev.equalTo("status", 1);
	queryPrev.limit(1000);
	queryPrev.find().then(function(prev_adjustDistricts) {
		for (var i = 0; i < prev_adjustDistricts.length; i ++) {
			var abd = prev_adjustDistricts[i];
			abd.set("status", 2);
		}
		return Parse.Object.saveAll(prev_adjustDistricts);
	}).then(function() {
		console.log("All GCUR_ADJUST_DISTRICT records with status being 1 have been succssfully changed to archived records.");
		
		// Find all current GCUR_ADJUST_DISTRICT records with status being 0
		queryCurr = new Parse.Query("GCUR_ADJUST_DISTRICT");
		queryCurr.equalTo("status", 0);
		queryCurr.limit(1000);
		return queryCurr.find();
	}).then(function(curr_adjustDistricts) {
		for (var i = 0; i < curr_adjustDistricts.length; i ++) {
			var abd = curr_adjustDistricts[i];
			
			// Set current to previous
			abd.set("status", 1);
		}
		return Parse.Object.saveAll(curr_adjustDistricts);
	}).then(function(list) {
		console.log("All current GCUR_ADJUST_DISTRICT records have been succssfully updated to previous records.");
		
		// Change all GCUR_ADJUST_LOCATION records with status being 1 to 2
		queryPrev = new Parse.Query("GCUR_ADJUST_LOCATION");
		queryPrev.equalTo("status", 1);
		queryPrev.limit(1000);
		return queryPrev.find();
	}).then(function(prev_adjustLocations) {
		for (var i = 0; i < prev_adjustLocations.length; i ++) {
			var abl = prev_adjustLocations[i];
			abl.set("status", 2);
		}
		return Parse.Object.saveAll(prev_adjustLocations);
	}).then(function() {
		console.log("All GCUR_ADJUST_LOCATION records with status being 1 have been succssfully changed to archived records.");
		
		// Find all current GCUR_ADJUST_LOCATION records with status being 0
		queryCurr = new Parse.Query("GCUR_ADJUST_LOCATION");
		queryCurr.equalTo("status", 0);
		queryCurr.limit(1000);
		return queryCurr.find();
	}).then(function(curr_adjustLocations) {
		for (var i = 0; i < curr_adjustLocations.length; i ++) {
			var abl = curr_adjustLocations[i];
			
			// Set current to previous
			abl.set("status", 1);
		}
		return Parse.Object.saveAll(curr_adjustLocations);
	}).then(function(list) {
		// All the objects were saved.
		console.log("All current GCUR_ADJUST_LOCATION records have been succssfully updated to previous records.");
		response.success();  //saveAll is now finished and we can properly exit with confidence :-)
	}, function(error) {
		response.error("Error: " + error.code + " " + error.message);
	});
});
*/

/**
Automate RunModel by adding a RunModel given defined creteria.
*/
Parse.Cloud.define("automateRunModel", function(request, response) {
	var executionResult = false;
	var executionMsg = "";
	var isJobAdded = false;

	var ToCreate = false;
	var ResToCreate = "";
	
	console.log("Triggering the Cloud Function 'automateRunModel'");
	
	// Get the parameters for startUTC and endUTC time period
	var nowDt = new Date(new Date().toUTCString());
	var today_utc_ts =  Date.UTC(nowDt.getUTCFullYear(), nowDt.getUTCMonth(), nowDt.getUTCDate(), 0, 0, 0);
	var greaterThanDt = new Date(today_utc_ts);
	console.log("Today starting at " + greaterThanDt);
	
	var queryRunModel = new Parse.Query("GCUR_RUNMODEL");
	queryRunModel.greaterThan("createdAt", greaterThanDt);
	queryRunModel.find().then(function(results) {
		
		switch (results.length) {
		
			// If no RunModel job has been added
			case 0:
				executionMsg += "No RunModel job was added. "
				console.log(executionMsg);
				
				ToCreate = true;
				ResToCreate = RESOLUTIONS[0];
				break;
			// If there is 1 RunModel job that has been added
			case 1:
				// If it has been completed
				executionMsg += "One RunModel job was added. "
				console.log(executionMsg);
				
				if (results[0].get("status") == 2) {
					// If it has been also failed
					if (results[0].get("jobResult") == false) {
						executionMsg += "status is Completed. jobResult was false. "
						console.log(executionMsg);
						
						ToCreate = true;
						ResToCreate = results[0].get("resolution");;
					}
					// If it has been also successful
					else {
						executionMsg += "status is Completed. jobResult was true. "
						console.log(executionMsg);
						
						ToCreate = true;
						currRes = results[0].get("resolution");
						ResToCreate = RESOLUTIONS.find(function(element) {
							return element != currRes;
						});
					}
					
				} else {
					executionMsg += "status is not Complete. So we will wait for this job to complete. No job to add. "
					console.log(executionMsg);
				}
				
				break; 
			// If there have been more than 2 RunModel jobs added
			default:
				executionMsg += "More than 2 RunModel jobs have been added. "
				console.log(executionMsg);
			
				var isAllJobsCompleted = true;
				
				for (var i = 0; i < results.length; i++) {
					
					// If any of the job was not complete (not started or in progress)
					if (results[i].get("status") != 2) {
						isAllJobsCompleted = false;
						break;
					}
				}
				
				// If all jobs were already complete; we will find out the details.
				if (isAllJobsCompleted) {
					executionMsg += "All RunModel jobs were with status of complete. "
					console.log(executionMsg);
					
					var predefined_rm_obs_list = [];
					
					for (var j = 0; j < RESOLUTIONS.length; j++) {
						var predefined_rm_obs = {
							"resolution" : RESOLUTIONS[j],
							"status" : undefined,
							"jobResult" : undefined,
							"jobResultDetails" : undefined
						}
						
						predefined_rm_obs_list.push(predefined_rm_obs);
					}		
					
					for (var k = 0; k < predefined_rm_obs_list.length; k++) {
						for (var i = 0; i < results.length; i++) {
							if (results[i].get("resolution") == predefined_rm_obs_list[k]['resolution']) {
								if (predefined_rm_obs_list[k]['jobResult'] != true) {
									predefined_rm_obs_list[k]['status'] = results[i].get("status");
									predefined_rm_obs_list[k]['jobResult'] = results[i].get("jobResult");
									predefined_rm_obs_list[k]['jobResultDetails'] = results[i].get("jobResultDetails");
								}
							}
						}
					}
					
					executionMsg += "'" + JSON.stringify(predefined_rm_obs_list) + "' ";
					console.log(executionMsg);
					// Find out whether there is need to create a new RunModel job
					for (var k = 0; k < predefined_rm_obs_list.length; k++) {

						if (predefined_rm_obs_list[k]['status'] != undefined) {
							// If this RunModel job was failed
							if (predefined_rm_obs_list[k]['jobResult'] != true) {
								ToCreate = true;
								ResToCreate = predefined_rm_obs_list[k]['resolution'];
								break;		// We always want to add a new RunModel model for those failed one first
							} else
								console.log(predefined_rm_obs_list[k]['resolution'] + ": " + predefined_rm_obs_list[k]['jobResult']);
						} else {
							ToCreate = true;
							ResToCreate = predefined_rm_obs_list[k]['resolution'];
						}
					}
				} else {
					executionMsg += "There is at least one job with its status being not Complete. So we will wait for this job to complete. "
					console.log(executionMsg);
				}
		}
		
		return Parse.Promise.as("Current RunModel jobs have been checked. Continue... ...");		
	}).then(function() {
		// Save a new RunModel job based on ResToCreate
		if (ToCreate) {
			var GCUR_RUNMODEL = Parse.Object.extend("GCUR_RUNMODEL");
			var newRMJob = new GCUR_RUNMODEL();				// a new GCUR_RUNMODEL object to be saved
			
			// Had to add a fake user ... REQUIRE AMENDMENT!!!
			var admin = new Parse.User();
			admin.id = SUPERUSER_OBJECTID;
			
			newRMJob.save({
				status: 0,
				resolution: ResToCreate,
				jobResult: false,
				submittedBy: admin
			}, {
				useMasterKey: true,
			
				success: function(obj) {
					// The save was successful.
					isJobAdded = true;
					executionMsg += "A new RunModel job with resolution of " + ResToCreate + " has been successfully saved. "
					console.log(executionMsg);
					response.success({"ToCreate": ToCreate, "ResToCreate": ResToCreate, 'executionMsg': executionMsg, 'isJobAdded': isJobAdded});
				},
				
				error: function(successful, error) {
					// The save failed.  Error is an instance of Parse.Error.
					executionMsg += "There was an error in saving a new RunModel job with resolution of " + ResToCreate;
					console.log(executionMsg);
					response.error({"ToCreate": ToCreate, "ResToCreate": ResToCreate, 'executionMsg': executionMsg, 'isJobAdded': isJobAdded});
				}
			});
		} else
			response.success({"ToCreate": ToCreate, "ResToCreate": ResToCreate, 'executionMsg': executionMsg, 'isJobAdded': isJobAdded});
	}, function(error) {
		// An error occurred while deleting one or more of the objects.
		// If this is an aggregate error, then we can inspect each error
		// object individually to determine the reason why a particular
		// object was not deleted.
	    if (error.code === Parse.Error.AGGREGATE_ERROR) {
	    	for (var i = 0; i < error.errors.length; i++) {
	          console.log("Couldn't delete " + error.errors[i].object.id +
	            "due to " + error.errors[i].message);
	        }
	    } else {
	    	console.log("Delete aborted because of " + error.message);
	    }
		response.success(false);
	});
});

/**
Automate FinaliseData by adding a FinaliseData given defined creteria.
*/
Parse.Cloud.define("automateFinaliseData", function(request, response) {
	var executionResult = false;
	var executionMsg = "";
	var isJobAdded = false;

	var isRunModelsSuccessful = false;
	var ToCreate = false;
	
	console.log("Triggering the Cloud Function 'automateFinaliseData'");
	
	// Get the parameters for startUTC and endUTC time period
	var nowDt = new Date(new Date().toUTCString());
	var today_utc_ts =  Date.UTC(nowDt.getUTCFullYear(), nowDt.getUTCMonth(), nowDt.getUTCDate(), 0, 0, 0);
	var greaterThanDt = new Date(today_utc_ts);
	console.log("Today starting at " + greaterThanDt);
	
	// Query the GCUR_RUNMODEL table to find out if the RunModel jobs for both resolutions have been successfully run
	// This is for double check to be more secure that we are not adding a FinaliseData job if RunModels were not successful.
	var queryRunModel = new Parse.Query("GCUR_RUNMODEL");
	queryRunModel.greaterThan("createdAt", greaterThanDt);
	queryRunModel.find().then(function(results) {
		
		switch (results.length) {
		
			// If no RunModel job has been added
			case 0:
				executionMsg += "No RunModel job was added. FinaliseData job will not be added. ";
				console.log(executionMsg);

				break;
				
			// If there is 1 RunModel job that has been added
			case 1:
				// If it has been completed
				executionMsg += "One RunModel job was added. FinaliseData job will not be added. ";
				console.log(executionMsg);
				
				break;
			
			// If there have been more than 2 RunModel jobs added
			default:
				executionMsg += "More than 2 RunModel jobs have been added. "
				console.log(executionMsg);
			
				var isAllJobsCompleted = true;
				
				for (var i = 0; i < results.length; i++) {
					
					// If any of the job was not complete (not started or in progress)
					if (results[i].get("status") != 2) {
						isAllJobsCompleted = false;
						break;
					}
				}
				
				// If all jobs were already complete; we will find out the details.
				if (isAllJobsCompleted) {
					executionMsg += "All RunModel jobs were with status of complete. "
					console.log(executionMsg);
					
					var predefined_rm_obs_list = [];
					
					for (var j = 0; j < RESOLUTIONS.length; j++) {
						var predefined_rm_obs = {
							"resolution" : RESOLUTIONS[j],
							"status" : undefined,
							"jobResult" : undefined,
							"jobResultDetails" : undefined
						}
						
						predefined_rm_obs_list.push(predefined_rm_obs);
					}		
					
					for (var k = 0; k < predefined_rm_obs_list.length; k++) {
						for (var i = 0; i < results.length; i++) {
							if (results[i].get("resolution") == predefined_rm_obs_list[k]['resolution']) {
								if (predefined_rm_obs_list[k]['jobResult'] != true) {
									predefined_rm_obs_list[k]['status'] = results[i].get("status");
									predefined_rm_obs_list[k]['jobResult'] = results[i].get("jobResult");
									predefined_rm_obs_list[k]['jobResultDetails'] = results[i].get("jobResultDetails");
								}
							}
						}
					}
					
					executionMsg += "'" + JSON.stringify(predefined_rm_obs_list) + "' ";
					console.log(executionMsg);
					
					// Find out whether RunModel jobs for both resolutions were already successful
					isRunModelsSuccessful = predefined_rm_obs_list.every(function(rm) {
						return (rm['status'] == 2) && (rm['jobResult'] == true);
					});					
					
				} else {
					executionMsg += "There is at least one RunModel job with its status being 'not Complete'. So we will wait for this job to complete. "
					console.log(executionMsg);
				}
		}
		
		executionMsg += ". isRunModelsSuccessful = " + isRunModelsSuccessful + ". ";
		console.log(executionMsg);
		
		if (isRunModelsSuccessful) {
			return Parse.Promise.as("isRunModelsSuccessful is true!");
		} else {
			return Parse.Promise.error("isRunModelsSuccessful is false!");	// Go straight to the error callback at the end
		}		
	}).then(function() {	
		var queryFinaliseData = new Parse.Query("GCUR_FINALISEMODEL");
		queryFinaliseData.greaterThan("createdAt", greaterThanDt);
		return queryFinaliseData.find();
	}).then(function(results) {			
		switch (results.length) {
			
				// If no FinaliseData job has been added
				case 0:
					executionMsg += "No FinaliseData job was added. "
					console.log(executionMsg);
					
					ToCreate = true;
					break;
				// If there is 1 FinaliseData job that has been added
				case 1:
					// If it has been completed
					executionMsg += "One FinaliseData job was already added. "
					console.log(executionMsg);
					
					if (results[0].get("status") == 2) {
						// If it has been also failed
						if (results[0].get("jobResult") == false) {
							executionMsg += "status is Completed. jobResult was false. No FinaliseData job to add. "
							console.log(executionMsg);
						}
						// If it has been also successful
						else {
							executionMsg += "status is Completed. jobResult was true. No FinaliseData job to add. "
							console.log(executionMsg);
						}
						
					} else {
						executionMsg += "status is not Complete. So we will wait for this FinaliseData job to complete. No job to add. "
						console.log(executionMsg);
					}
					
					break; 
				// If there have been more than 2 FinaliseData jobs added
				default:
					executionMsg += "More than 2 FinaliseData jobs have been added. No FinaliseData job to add. "
					console.log(executionMsg);
		}
			
		return Parse.Promise.as("Current FinaliseData jobs have been checked. Continue... ...");		
	}).then(function() {
		// Save a new FinalisedData job based on ResToCreate
		if (ToCreate) {
			var GCUR_FINALISEMODEL = Parse.Object.extend("GCUR_FINALISEMODEL");
			var newFDJob = new GCUR_FINALISEMODEL();				// a new GCUR_FINALISEMODEL object to be saved
			
			// Had to add a fake user ... REQUIRE AMENDMENT!!!
			var admin = new Parse.User();
			admin.id = SUPERUSER_OBJECTID;
			
			newFDJob.save({
				status: 0,
				jobResult: false,
				submittedBy: admin
			}, {
				useMasterKey: true,
			
				success: function(obj) {
					// The save was successful.
					isJobAdded = true;
					executionMsg += "A new FinalisedData job has been successfully saved. "
					console.log(executionMsg);
					response.success({"ToCreate": ToCreate, 'executionMsg': executionMsg, 'isJobAdded': isJobAdded});
				},
				
				error: function(successful, error) {
					// The save failed.  Error is an instance of Parse.Error.
					executionMsg += "There was an error in saving a new FinalisedData job. ";
					console.log(executionMsg);
					response.error({"ToCreate": ToCreate, 'executionMsg': executionMsg, 'isJobAdded': isJobAdded, 'error': error});
				}
			});
		} else
			response.success({"ToCreate": ToCreate, 'executionMsg': executionMsg, 'isJobAdded': isJobAdded});
	}, function(error) {
		response.error({"ToCreate": ToCreate, 'executionMsg': executionMsg, 'isJobAdded': isJobAdded, 'error': error});
	});
});

/**
 * An Underscore utility function to find elements in array that are not in another array;
 * used in the cloud function "applyValidationByException"
 */
function inAButNotInB(A, B) {
	return _.filter(A, function (a) {
		return !_.contains(B, a);
	});
}

/********
* Array utility functions
********/
Array.prototype.contains = function (obj) {
    for (var i = 0; i < this.length; i++) {
        if (this[i] === obj) {
            return true;
        }
    }
    return false;
}

Array.prototype.each = function(fn){
    fn = fn || Function.K;
     var a = [];
     var args = Array.prototype.slice.call(arguments, 1);
     for(var i = 0; i < this.length; i++){
         var res = fn.apply(this,[this[i],i].concat(args));
         if(res != null) a.push(res);
     }
     return a;
};

Array.prototype.uniquelize = function(){
     var ra = new Array();
     for(var i = 0; i < this.length; i ++){
         if(!ra.contains(this[i])){
            ra.push(this[i]);
         }
     }
     return ra;
};

Array.complement = function(a, b){
     return Array.minus(Array.union(a, b),Array.intersect(a, b));
};

Array.intersect = function(a, b){
     return a.uniquelize().each(function(o){return b.contains(o) ? o : null});
};

Array.minus = function(a, b){
     return a.uniquelize().each(function(o){return b.contains(o) ? null : o});
};

Array.union = function(a, b){
     return a.concat(b).uniquelize();
};

/******
Function to check if today is Tuesday (GMT); time is between 10.45 pm and 11.15 pm (GMT) for Request for Validation email Job;
this is equivalent to Wednesday 8:45 am and 9:15 am (AEST)
******/
function isTodayTuesday() {
	var today = new Date();
	if(today.getDay() == 2)
		return true;
	else
		return false;
}

function isToSendRequestForValidationEmail() {
	var startTime = JOB_START_TIME;
	var endTime = JOB_END_TIME;

	var curr_time = getval();
	
	if ((isTodayTuesday()) && (get24Hr(curr_time) > get24Hr(startTime) && get24Hr(curr_time) < get24Hr(endTime))) {
	    //in between these two times
		return true;
	} else {
		return false;
	}
}

function get24Hr(time){
    var hours = Number(time.match(/^(\d+)/)[1]);
    var AMPM = time.match(/\s(.*)$/)[1];
    if(AMPM == "PM" && hours<12) hours = hours+12;
    if(AMPM == "AM" && hours==12) hours = hours-12;
    
    var minutes = Number(time.match(/:(\d+)/)[1]);
    hours = hours*100+minutes;
    console.log(time +" - "+hours);
    return hours;
}

function getval() {
    var currentTime = new Date()
    var hours = currentTime.getHours()
    var minutes = currentTime.getMinutes()

    if (minutes < 10) minutes = "0" + minutes;

    var suffix = "AM";
    if (hours >= 12) {
        suffix = "PM";
        hours = hours - 12;
    }
    if (hours == 0) {
        hours = 12;
    }
    var current_time = hours + ":" + minutes + " " + suffix;

    return current_time;
}

/**
 * Returns the last day of the a year and a month
 * e.g. getLastDayOfMonth(2009, 9) returns 30;
 */
function getLastDayOfMonth(Year, Month) {
	var newD = new Date( (new Date(Year, Month,1))-1 );
    return newD.getDate();
}

/**
 * Returns a description of the current date in AEST
 * Parameters:
 * - isDLS: boolean; indicates if it is currently Daylight Saving Time.
 */
function getTodayString(isDLS) {
	var today = new Date();	// ALWAYS IN UTC TIME
	// NOTE: this is to initialize a JS date object in the timezone of the computer/server the function is called.
	// So this is UTC time. There are 10 (11) hrs difference between UTC time and Australian Eastern Standard Time (Daylight Saving Time).
	
	var dd = today.getDate();
	var mm = today.getMonth() + 1;	//January is 0!
	var yyyy = today.getFullYear();
	var hr = today.getHours();	// from 0 - 23!
	
	var lastDayOfTheMonth = getLastDayOfMonth(yyyy, mm);
	
	// is DayLight Saving enabled
	if (isDLS) {
		if (hr>=13)	// "13" hr in UTC is equivalent to "00" hr in AEST the next day!
			dd = dd + 1;
	} else {
		if (hr>=14)	// "14" hr in UTC is equivalent to "00" hr in AEST the next day!
			dd = dd + 1;
	}
	
	// fix the cross-month issue
	if (dd > lastDayOfTheMonth) {
		dd = 1;	// first day of next month
		mm = mm + 1;	// next month
	}
	
	// fix the cross-year issue
	if (mm > 12) {
		mm = 1;
		yyyy = yyyy + 1;
	}
	
	if(dd<10)
		dd = '0' + dd

	if(mm<10)
		mm = '0' + mm

	var strToday = dd + '/' + mm + '/' + yyyy;
	
	return strToday;
}

/*
 * Sort the Array of JSON by the value of a key/field in the JSON
 */
var sort_by = function(field, reverse, primer){
	var key = primer ? function(x) {return primer(x[field])} : function(x) {return x[field]};

	reverse = !reverse ? 1 : -1;

	return function (a, b) {
		return a = key(a), b = key(b), reverse * ((a > b) - (b > a));
	} 
}

/*********************************************************************************************************************************************/
/**
 * Returns number of days between two Date objects
 */
function numDaysBetween(d1, d2) {
	var diff = Math.abs(d1.getTime() - d2.getTime());
	return diff / (1000 * 60 * 60 * 24);
};

/**
 * Returns a boolean if a previous obs (ObservationStatus = 1) is MAX_DAYS_ALLOWED_FOR_PREVIOUS_OBS days older than Today.
 */
function isObsTooOld(finalisedDate) {
	var today = new Date();
	var numberOfDaysBetween = numDaysBetween(today, finalisedDate);
	
	if (numberOfDaysBetween > MAX_DAYS_ALLOWED_FOR_PREVIOUS_OBS)
		return true;
	else
		return false;
}
/*********************************************************************************************************************************************/