
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
	console.log("*** FLAG 1");
	if(!request.object.existed()) {
		console.log("*** FLAG 2");
		var sharedJurisSettingsQ = new Parse.Query("GCUR_SHARED_JURIS_SETTINGS");
		console.log("*** FLAG 21");

/*
		sharedJurisSettingsQ.find().then(function(sjsObjs) {
			console.log("*** FLAG 22");
			for (var i = 0; i < sjsObjs.length; i ++) {
				var jurisdiction = sjsObjs[i].get("Jurisdiction");
				console.log("*** jurisdiction:" + jurisdiction);
				sharedWithJurisArr.push(jurisdiction);
			}
			console.log("*** FLAG 23");

			var sharedByArr = [];
			console.log("*** FLAG 24");

			for (var i = 0; i < sharedWithJurisArr.length; i ++) {
				sharedByArr.push({
					"st" : sharedWithJurisArr[i],
					"sh" : true
				});
			}
			console.log("*** FLAG 25");

			request.object.set("SharedBy", JSON.stringify(sharedByArr));
			console.log("*** FLAG 3");
			response.success();
		});
*/
		request.object.set("SharedBy", "HELLO WORLD");
		console.log("*** FLAG 31");
		response.success();

	} else {
		console.log("*** FLAG 4");
		response.success();
	}
});

/**
 * Retrieve all Finalise Date based on the "createdAt" column of the GCUR_FINALISEMODEL class
 */
Parse.Cloud.define('getAllFinalisedDate', function(request, response) {
	Parse.Cloud.useMasterKey();
	
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

Parse.Cloud.define('getAllCurrentObs', function(request, response) {
	//Parse.Cloud.useMasterKey();
	
	var queryObs = new Parse.Query("GCUR_OBSERVATION");
	queryObs.ascending("createdAt");
	queryObs.equalTo("ObservationStatus", 0);
	queryObs.limit(1000);
	
	queryObs.find().then(function(results) {
		response.success(results.length);
	}, function(error) {
		response.error("Error: " + error.code + " " + error.message);
	});
});
