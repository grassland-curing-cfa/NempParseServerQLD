
Parse.Cloud.define('hello', function(req, res) {
  res.success("Hello world from " + process.env.APP_NAME);
});

/**
 * Populate all ShareBy{STATE} columns available by "True" beforeSave a new Observation is added
 */
Parse.Cloud.beforeSave("GCUR_OBSERVATION", function(request, response) {
	console.log("*** beforeSave on GCUR_OBSERVATION called");
	Parse.Cloud.useMasterKey();
	sharedWithJurisArr = [];
	
	if(!request.object.existed()) {
		
		var sharedJurisSettingsQ = new Parse.Query("GCUR_SHARED_JURIS_SETTINGS");
		
		sharedJurisSettingsQ.find().then(function(sjsObjs) {
			for (var i = 0; i < sjsObjs.length; i ++) {
				var jurisdiction = sjsObjs[i].get("Jurisdiction");
				console.log("*** jurisdiction:" + jurisdiction);
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
	} else
		response.success();
});