import { publicIpv4, publicIpv6 } from "public-ip";
import { writeFile, readFileSync } from "fs";
const fileName = "./config.json";
var config = JSON.parse(readFileSync(fileName, "utf8"));

async function main() {
	try {
		// Load Config
		if (!config.hostname) {
			throw Error("Hostname missing");
		}
		let cfAuthHeaders = {};
		if (config.bearerToken) {
			cfAuthHeaders = {
				Authorization: `Bearer ${config.bearerToken}`,
			};
		} else {
			throw Error("Bearer Token missing");
		}

		// Get my new IP
		let myIp = await getIp();
		console.log(myIp);
		//update dns info if Ip is different from before
		if (myIp.ip4 != config.myIp4 || myIp.ip6 != config.myIp6) {
			console.log("updating ip");
			// Get Zone ID
			const cfZoneId = await getCfZoneId(config.hostname, cfAuthHeaders);
			// Get DNS Record ID
			const cfDnsIdRes = await getRemoteId(config.hostname, cfAuthHeaders, cfZoneId);
			// Update DNS Records
			await updateDNSRecords(cfAuthHeaders, cfZoneId, cfDnsIdRes, myIp);
			// Save new Ip
			config.myIp4 = myIp.ip4;
			config.myIp6 = myIp.ip6;
			saveNewConfig(config, fileName);
		} else {
			console.log("ip already uptodate.");
		}
	} catch (e) {
		console.error(e);
	}
}

// entry
main();

async function getIp() {
	let checkIp6 = null;
	try {
		checkIp6 = await publicIpv6();
	} catch {}
	let checkIp4 = null;
	try {
		checkIp4 = await publicIpv4();
	} catch {}
	return { ip4: checkIp4 ? checkIp4 : "", ip6: checkIp6 ? checkIp6 : "" };
}
async function getCfZoneId(hostname, cfAuthHeaders) {
	const cfZoneIdReqUrl = `https://api.cloudflare.com/client/v4/zones?name=${encodeURI(`${hostname.split(".").reverse()[1]}.${hostname.split(".").reverse()[0]}`)}`;
	const cfZoneIdRes = await (await fetch(cfZoneIdReqUrl, { headers: cfAuthHeaders })).json();
	if (cfZoneIdRes.length <= 0) {
		throw Error("Zone not found");
	}
	console.log("Zone ID: ", cfZoneIdRes.result[0].id);
	return cfZoneIdRes.result[0].id;
}
async function getRemoteId(hostname, cfAuthHeaders, cfZoneId) {
	const cfDnsIdReqUrl = `https://api.cloudflare.com/client/v4/zones/${encodeURI(cfZoneId)}/dns_records?name=${encodeURI(hostname)}`;
	const cfDnsIdRes = await (await fetch(cfDnsIdReqUrl, { headers: cfAuthHeaders })).json();
	if (cfDnsIdRes.result.length <= 0) {
		throw Error("DNS record not found");
	}
	return cfDnsIdRes.result;
}
async function updateDNSRecords(cfAuthHeaders, cfZoneId, cfDnsIdRes, myIp) {
	for (const cfDnsRecord of cfDnsIdRes) {
		if (cfDnsRecord.type == "A" || cfDnsRecord.type == "AAAA") {
			//A == ip4, AAAA == ip6
			console.log("DNS Record ID: ", cfDnsRecord.id);
			const cfPutReqUrl = `https://api.cloudflare.com/client/v4/zones/${encodeURI(cfZoneId)}/dns_records/${encodeURI(cfDnsRecord.id)}`;
			const cfPutReqData = {
				type: cfDnsRecord.type,
				name: cfDnsRecord.name,
				content: cfDnsRecord.type == "A" ? myIp.ip4 : myIp.ip6,
			};
			console.log(cfPutReqUrl, cfPutReqData);
			let result = await (await fetch(cfPutReqUrl, { method: "PUT", headers: cfAuthHeaders, body: JSON.stringify(cfPutReqData) })).json();
			if (!result) {
				console.error(`Warning: null result received, see above for error messages`);
				return;
			}
			if (result.success === true) {
				console.log(`DNS Record update success: `, JSON.stringify(result, undefined, 2));
			} else {
				throw Error(`DNS Record update failed: `, JSON.stringify(result.errors, undefined, 2));
			}
		} else {
			console.error(`DNS Record Type unsupported: ${cfDnsRecord.type}`);
		}
	}
}
function saveNewConfig(config, fileName) {
	writeFile(fileName, JSON.stringify(config), (err) => {
		if (err) return console.log(err);
		console.log(JSON.stringify(config));
		console.log("writing to " + fileName);
	});
}
