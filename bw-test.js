
(function() {

var defaults = {
	version: "1.3",
	auto_run: true,
	log_level: 'none',
	sample: 100,

	base_url: '',
	beacon_url: '',

	timeout: 15000,
	nruns: 5,
	latency_runs: 10
};



// ------------------------------------------------------------------------------------
// Do not change anything below this line unless you're adding new features/fixing bugs
// ------------------------------------------------------------------------------------

if(typeof PERFORMANCE === 'undefined')
	window.PERFORMANCE = {};

if(typeof PERFORMANCE.BWTest === 'undefined')
	PERFORMANCE.BWTest = {};

if(typeof PERFORMANCE.BWTest.version !== 'undefined' ) {
	return false;		// don't allow this script to be included twice
}

for(var k in defaults) {
	if(defaults.hasOwnProperty(k) && typeof PERFORMANCE.BWTest[k] === 'undefined')
		PERFORMANCE.BWTest[k] = defaults[k];
}

if(!PERFORMANCE.BWTest.base_url) {
	alert('Set the base_url variable in this script the the directory where your bandwidth images are stored');
	return false;
}

// if this page view does not fall into the random sample, don't bother with the test
if(Math.random()*100 >= PERFORMANCE.BWTest.sample)
	return true;

var base_url = PERFORMANCE.BWTest.base_url;
var beacon_url = PERFORMANCE.BWTest.beacon_url;
var timeout = { t: PERFORMANCE.BWTest.timeout, h: null};
var nruns = PERFORMANCE.BWTest.nruns;
var latency_runs = PERFORMANCE.BWTest.latency_runs;


var runs_left=nruns;

// We choose image sizes so that we can narrow down on a bandwidth range as soon as possible
// the sizes chosen correspond to bandwidth values of 14-64kbps, 64-256kbps, 256-1024kbps, 1-2Mbps, 2-8Mbps, 8-30Mbps & 30Mbps+
// Anything below 14kbps will probably timeout before the test completes
// Anything over 60Mbps will probably be unreliable since latency will make up the largest part of download time
// If you want to extend this further to cover 100Mbps & 1Gbps networks, use image sizes of 19,200,000 & 153,600,000 bytes respectively
// See https://spreadsheets.google.com/ccc?key=0AplxPyCzmQi6dDRBN2JEd190N1hhV1N5cHQtUVdBMUE&hl=en_GB for a spreadsheet with the details
var images=[
	{ name: "image-0.png", size: 11483, timeout: 1400 }, 
	{ name: "image-1.png", size: 40658, timeout: 1200 }, 
	{ name: "image-2.png", size: 164897, timeout: 1300 }, 
	{ name: "image-3.png", size: 381756, timeout: 1500 }, 
	{ name: "image-4.png", size: 1234664, timeout: 1200 }, 
	{ name: "image-5.png", size: 4509613, timeout: 1200 }, 
	{ name: "image-6.png", size: 9084559, timeout: 1200 }
];

var nimages = images.length;
var smallest_image = 0;

// abuse arrays to do the latency test simply because it avoids a bunch of branches in the rest of the code
images['l'] = { name: "image-l.gif", size: 35, timeout: 1000 };

var results = [];
var latencies = [];
var latency = null;
var aborted = false;
var test_start = null;

if(typeof console === 'undefined')
	console = { log: function() {} };

var console_log = function() {
	if(PERFORMANCE.BWTest.log_level === 'debug')
		console.log(arguments[0]);
}

PERFORMANCE.BWTest.init = function()
{
	if(timeout.h) {
		clearTimeout(timeout.h);
		timeout.h = null;
	}

	runs_left=nruns;
	latency_runs=10;
	smallest_image=0;
	results = [];
	latencies = [];
	latency = null;
	aborted = false;
	test_start = null;
};

PERFORMANCE.BWTest.run = function()
{
	timeout.h = setTimeout(PERFORMANCE.BWTest.abort, timeout.t);

	test_start = new Date().getTime();
	defer(iterate);
};

PERFORMANCE.BWTest.abort = function()
{
	aborted = true;
	finish();	// we don't defer this call because it might be called from onbeforeunload
			// and we want the entire chain to complete before we return
};

var iterate = function()
{
	if(aborted) {
		return false;
	}

	if(!runs_left) {
		finish();
	}
	else if(latency_runs) {
		if(PERFORMANCE.BWTest.onloop)
			if(PERFORMANCE.BWTest.onloop({ type: "latency", runs_left: latency_runs }) === false)
				return finish();
		load_img('l', latency_runs--, lat_loaded);
	}
	else {
		results.push({r:[]});
		if(PERFORMANCE.BWTest.onloop)
			if(PERFORMANCE.BWTest.onloop({ type: "bandwidth", runs_left: runs_left }) === false)
				return finish();
		load_img(smallest_image, runs_left--, img_loaded);
	}
};

var defer = function(method)
{
	return setTimeout(method, 10);
};

var load_img = function(i, run, callback)
{
	var url = base_url + images[i].name + '?t=' + (new Date().getTime()) + Math.random();
	var timer=0, tstart=0;
	var img = new Image();

	img.onload=function() { img=null; clearTimeout(timer); if(callback) callback(i, tstart, run, true); callback=null; };
	img.onerror=function() { img=null; clearTimeout(timer); if(callback) callback(i, tstart, run, false); callback=null; };

	// the timeout does not abort download of the current image, it just sets an end of loop flag so we don't attempt download of the next image
	// we still need to wait until onload or onerror fire to be sure that the image download isn't using up bandwidth.
	// This also saves us if the timeout happens on the first image.  If it didn't, we'd have nothing to measure.
	timer=setTimeout(function() { if(callback) callback(i, tstart, run, null); }, images[i].timeout + Math.min(400, latency ? latency.mean : 400));

	tstart = new Date().getTime();
	img.src=url;
};

var lat_loaded = function(i, tstart, run, success)
{
	if(run != latency_runs+1)
		return;

	if(success !== null) {
		var lat = new Date().getTime() - tstart;
		latencies.push(lat);
	}
	// if we've got all the latency images at this point, we can calculate latency
	if(latency_runs === 0) {
		latency = calc_latency();
	}

	defer(iterate);
};

var img_loaded = function(i, tstart, run, success)
{
	if(run != runs_left+1)
		return;

	if(results[nruns-run].r[i])		// already called on this image
		return;

	if(success === null) {			// if timeout, then we set the next image to the end of loop marker
		results[nruns-run].r[i+1] = {t:null, state: null, run: run};
		return;
	}

	var result = { start: tstart, end: new Date().getTime(), t: null, state: success, run: run };
	if(success) {
		result.t = result.end-result.start;
	}
	results[nruns-run].r[i] = result;

	// we terminate if an image timed out because that means the connection is too slow to go to the next image
	if(i >= nimages-1 || typeof results[nruns-run].r[i+1] !== 'undefined') {
		console_log(results[nruns-run]);

		// First run is a pilot test to decide what the largest image that we can download is
		// All following runs only try to download this image
		if(run === nruns) {
			smallest_image = i;
		}
		defer(iterate);
	} else {
		load_img(i+1, run, img_loaded);
	}
};

var ncmp = function(a, b) { return (a-b); };

var calc_latency = function()
{
	var	i, n,
		sum=0, sumsq=0,
		amean, median,
		std_dev, std_err;

	// We first do IQR filtering and use the resulting data set for all calculations
	var lat_filtered = iqr(latencies.sort(ncmp));
	n = lat_filtered.length;

	console_log(lat_filtered);	// sometimes this results in an empty array

	// First we get the arithmetic mean, standard deviation and standard error
	// We ignore the first since it paid the price of DNS lookup, TCP connect and slow start
	for(i=1; i<n; i++) {
		sum += lat_filtered[i];
		sumsq += lat_filtered[i] * lat_filtered[i];
	}

	n--;	// Since we started the loop with 1 and not 0

	amean = Math.round(sum / n);

	std_dev = Math.sqrt( sumsq/n - sum*sum/(n*n));

	// See http://en.wikipedia.org/wiki/1.96 and http://en.wikipedia.org/wiki/Standard_error_%28statistics%29
	std_err = (1.96 * std_dev/Math.sqrt(n)).toFixed(2);

	std_dev = std_dev.toFixed(2);


	n = lat_filtered.length-1;

	median = Math.round((lat_filtered[Math.floor(n/2)] + lat_filtered[Math.ceil(n/2)])/2);


	return { mean: amean, median: median, stddev: std_dev, stderr: std_err };
};

var calc_bw = function(latency)
{
	var	i, j, n=0,
		r, bandwidths=[], bandwidths_corrected=[],
		sum=0, sumsq=0, sum_corrected=0, sumsq_corrected=0,
		amean, std_dev, std_err, median,
		amean_corrected, std_dev_corrected, std_err_corrected, median_corrected;

	for(i=0; i<nruns; i++) {
		if(!results[i] || !results[i].r) {
			continue;
		}

		r=results[i].r;

		// the next loop we iterate through backwards and only consider the largest 3 images that succeeded
		// that way we don't consider small images that downloaded fast without really saturating the network
		var nimgs=0;
		for(j=r.length-1; j>=0 && nimgs<3; j--) {
			if(typeof r[j] === 'undefined')	// if we hit an undefined image time, it means we skipped everything before this
				break;
			if(r[j].t === null)
				continue;

			n++;
			nimgs++;

			var bw = images[j].size*1000/r[j].t;
			bandwidths.push(bw);

			var bw_c = images[j].size*1000/(r[j].t - latency);
			bandwidths_corrected.push(bw_c);
		}
	}

	console_log('got ' + n + ' readings');

	console_log('bandwidths: ' + bandwidths);
	console_log('corrected: ' + bandwidths_corrected);

	// First do IQR filtering since we use the median here and should use the stddev after filtering.
	if(bandwidths.length > 3) {
		bandwidths = iqr(bandwidths.sort(ncmp));
		bandwidths_corrected = iqr(bandwidths_corrected.sort(ncmp));
	} else {
		bandwidths = bandwidths.sort(ncmp);
		bandwidths_corrected = bandwidths_corrected.sort(ncmp);
	}

	console_log('after iqr: ' + bandwidths);
	console_log('corrected: ' + bandwidths_corrected);

	// Now get the mean & median.  Also get corrected values that eliminate latency
	n = Math.max(bandwidths.length, bandwidths_corrected.length);
	for(i=0; i<n; i++) {
		if(i<bandwidths.length) {
			sum += bandwidths[i];
			sumsq += Math.pow(bandwidths[i], 2);
		}
		if(i<bandwidths_corrected.length) {
			sum_corrected += bandwidths_corrected[i];
			sumsq_corrected += Math.pow(bandwidths_corrected[i], 2);
		}
	}

	n = bandwidths.length;
	amean = Math.round(sum/n);
	std_dev = Math.sqrt(sumsq/n - Math.pow(sum/n, 2));
	std_err = Math.round(1.96 * std_dev/Math.sqrt(n));
	std_dev = Math.round(std_dev);

	n = bandwidths.length-1;
	median = Math.round((bandwidths[Math.floor(n/2)] + bandwidths[Math.ceil(n/2)])/2);

	n = bandwidths_corrected.length;
	amean_corrected = Math.round(sum_corrected/n);
	std_dev_corrected = Math.sqrt(sumsq_corrected/n - Math.pow(sum_corrected/n, 2));
	std_err_corrected = (1.96 * std_dev_corrected/Math.sqrt(n)).toFixed(2);
	std_dev_corrected = std_dev_corrected.toFixed(2);

	n = bandwidths_corrected.length-1;
	median_corrected = Math.round((bandwidths_corrected[Math.floor(n/2)] + bandwidths_corrected[Math.ceil(n/2)])/2);

	console_log('amean: ' + amean + ', median: ' + median);
	console_log('corrected amean: ' + amean_corrected + ', median: ' + median_corrected);

	return {
		mean: amean,
		stddev: std_dev,
		stderr: std_err,
		median: median,
		mean_corrected: amean_corrected,
		stddev_corrected: std_dev_corrected,
		stderr_corrected: std_err_corrected,
		median_corrected: median_corrected
	};
};

var finish = function()
{
	if(timeout.h) {
		clearTimeout(timeout.h);
		timeout.h = null;
	}

	if(!latency)
		latency = calc_latency();
	var bw = calc_bw(latency.mean);

	var test_time = new Date().getTime() - test_start;

	if(beacon_url) {
		var img = new Image();
		img.src = beacon_url + '?bw=' + bw.median_corrected + '&bwa=' + bw.mean_corrected + '&bwsd=' + bw.stddev_corrected + '&bwse=' + bw.stderr_corrected
			+ '&latency=' + latency.median + '&latencya=' + latency.mean + '&latencysd=' + latency.stddev + '&latencyse=' + latency.stderr
			+ '&v=' + encodeURIComponent(PERFORMANCE.BWTest.version);
	}

	var o = {
		bandwidth_median:	bw.median_corrected,
		bandwidth_amean:	bw.mean_corrected,
		bandwidth_stddev:	parseFloat(bw.stddev_corrected, 10),
		bandwidth_stderr:	parseFloat(bw.stderr_corrected, 10),
		latency_median:		latency.median,
		latency_amean:		latency.mean,
		latency_stddev:		parseFloat(latency.stddev, 10),
		latency_stderr:		parseFloat(latency.stderr, 10),
		test_time:		test_time
	};

	for(var k in o) {
		if(o.hasOwnProperty(k))
			PERFORMANCE.BWTest[k] = o[k];
	}

	if(PERFORMANCE.BWTest.oncomplete)
		PERFORMANCE.BWTest.oncomplete(o);
};

var iqr = function(a)
{
	var l = a.length-1;
	var q1 = (a[Math.floor(l*0.25)] + a[Math.ceil(l*0.25)])/2;
	var q3 = (a[Math.floor(l*0.75)] + a[Math.ceil(l*0.75)])/2;

	var fw = (q3-q1)*1.5;

	var b=[];

	l++;

	for(var i=0; i<l && a[i] < q3+fw; i++) {
		if(a[i] > q1-fw) {
			b.push(a[i]);
		}
	}

	return b;
};

PERFORMANCE.BWTest.init();
if(PERFORMANCE.BWTest.auto_run)
	PERFORMANCE.BWTest.run();

}());

if(PERFORMANCE.BWTest.onload)
	PERFORMANCE.BWTest.onload();
