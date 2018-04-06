/*
 ***** BEGIN LICENSE BLOCK *****
 
 This file is part of the Zotero Data Server.
 
 Copyright © 2018 Center for History and New Media
 George Mason University, Fairfax, Virginia, USA
 http://zotero.org
 
 This program is free software: you can redistribute it and/or modify
 it under the terms of the GNU Affero General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.
 
 This program is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU Affero General Public License for more details.
 
 You should have received a copy of the GNU Affero General Public License
 along with this program.  If not, see <http://www.gnu.org/licenses/>.
 
 ***** END LICENSE BLOCK *****
 */

const request = require('request');
const XRegExp = require('xregexp');

function normalize(text) {
	let rx = XRegExp('[^\\pL 0-9]', 'g');
	text = XRegExp.replace(text, rx, '');
	text = text.normalize('NFKD');
	text = XRegExp.replace(text, rx, '');
	text = text.toLowerCase();
	return text;
}

function queryWorldcat(str) {
	return new Promise(function (resolve, reject) {
		request({
			url: 'https://www.worldcat.org/search?q=' + encodeURIComponent(str),
			method: 'GET',
		}, function (err, res) {
			if (err) return reject(err);
			let list = [];
			let rx = /(<td class="result details">)([\s\S]*?)(<ul class="options">)/g;
			
			let m;
			while (m = rx.exec(res.body)) {
				try {
					let title = m[2].match(/(er=brief_results"><strong>)([\s\S]*?)(<\/strong><\/a>)/)[2];
					let authors = m[2].match(/("author">by )([\s\S]*?)(<\/div><div class="type">)/)[2].split(';').filter(x => x).map(x => x.trim());
					let publish = m[2].match(/("itemPublisher">)([\s\S]*?)(<\/span><\/div><!-)/);
					if(publish) {
						publish=publish[2];
					} else {
						publish = m[2].match(/(">Publication: )([\s\S]*?)(<\/div><!--)/)[2];
					}
					
					let year = publish.match(/[0-9]{4}/)[0];
					list.push({
						title, authors, years: [year]
					});
				}
				catch (e) {
				}
			}
			
			resolve(list);
		});
	});
}

function queryCrossref(str) {
	return new Promise(function (resolve, reject) {
		request({
			url: 'http://api.crossref.org/works/?query.bibliographic=' + encodeURIComponent(str) + '&rows=10',
			method: 'GET',
			timeout: 0,
			headers: {}
			
		}, function (err, res) {
			if (err) return reject(err);
			
			res = JSON.parse(res.body);
			
			let list = [];
			for (let item of res.message.items) {
				let item2 = {title: '', subtitle: ''};
				if (item.title) item2.title = item.title[0];
				if (item.subtitle) item2.subtitle = item.subtitle[0];
				if (item.ISBN) item2.isbn = item.ISBN;
				item2.doi = item.DOI;
				
				item2.years = [];
				
				if (item['published-online']) item2.years.push(item['published-online']['date-parts'][0][0].toString());
				if (item['published-print']) item2.years.push(item['published-print']['date-parts'][0][0].toString());
				if (item['published']) item2.years.push(item['published']['date-parts'][0][0].toString());
				
				if (item['issued'] && item['issued']['date-parts'] && item['issued']['date-parts'][0] && item['issued']['date-parts'][0][0]) item2.issued = item['issued']['date-parts'][0][0].toString();
				
				item2.authors = [];
				if (item.author) {
					for (let author of item.author) {
						let names = '';
						if (author.given) names += author.given + ' ';
						if (author.family) names += author.family;
						item2.authors.push(names);
					}
				}
				
				list.push(item2);
			}
			resolve(list);
		});
	});
}

function hasAuthor(authors, word) {
	for (let author of authors) {
		let names = '';
		author = normalize(author);
		names = author.split(' ').filter(x => x);
		if (names.indexOf(word) >= 0) return true;
	}
	return false;
}

function formatItem(item) {
	let text = item.title;
	if (item.years.length) text += ' (' + item.years[0] + ')';
	if (item.authors) text += ' ' + item.authors.join(', ');
	return text;
}

async function searchCrossref(q) {
	let nq = normalize(q);
	let nqp = nq.split(' ').filter(x => x);
	
	let res2 = await queryCrossref(q);
	
	let results = [];
	
	for (let item of res2) {
		let title = item.title;
		let subtitle = item.subtitle;
		title = title.replace(/[:]/g, ' ');
		subtitle = subtitle.replace(/[:]/g, ' ');
		let normTitle = normalize(title);
		let normSubtitle = normalize(subtitle);
		
		let nt = normTitle;
		if (normTitle !== normSubtitle) nt += ' ' + normTitle;
		
		let ntp = nt.split(' ').filter(x => x);
		
		let maxFrom = 0;
		let maxLen = 0;
		
		for (let i = 0; i < nqp.length; i++) {
			for (let j = nqp.length; j > 0; j--) {
				let a = nqp.slice(i, j);
				let b = ntp.slice(0, a.length);
				if (a.length && b.length && a.join(' ') === b.join(' ')) {
					if (a.length > maxLen) {
						maxFrom = i;
						maxLen = j;
					}
				}
			}
		}
		
		if (maxLen) {
			let foundPart = nqp.slice(maxFrom, maxLen);
			
			let rems = nqp.slice(0, maxFrom);
			rems = rems.concat(nqp.slice(maxLen));
			
			if (rems.length) {
				let foundAuthor = false;
				let hasNumber = false;
				let yearFound = false;
				
				let rems2 = [];
				
				for (let rem of rems) {
					if (hasAuthor(item.authors, rem)) {
						foundAuthor = true;
					}
					else if (parseInt(rem) == rem && rem.length == 4) {
						hasNumber = true;
						if (item.years.indexOf(rem) >= 0) {
							yearFound = true;
						}
						else {
							rems2.push(rem);
						}
					}
					else {
						rems2.push(rem);
					}
				}
				
				if (hasNumber && !yearFound) continue;
				if (rems2.length && !foundAuthor) continue;
			}
			
			results.push(formatItem(item) + ' (CrossRef)');
		}
	}
	return results;
}

async function searchWorldcat(query) {
	let nq = normalize(query);
	nq = nq.replace(/ and /ig, '');
	let nqp = nq.split(' ').filter(x => x);
	
	let res2 = await queryWorldcat(query);
	
	let results = [];
	
	for (let item of res2) {
		let title = item.title;
		
		title = title.replace(/[:]/g, ' ');
		title = title.replace(/ and /ig, '');
		
		let normTitle = normalize(title);
		
		let nt = normTitle;
		
		let ntp = nt.split(' ').filter(x => x);
		
		let maxFrom = 0;
		let maxLen = 0;
		
		for (let i = 0; i < nqp.length; i++) {
			for (let j = nqp.length; j > 0; j--) {
				let a = nqp.slice(i, j);
				let b = ntp.slice(0, a.length);
				if (a.length && b.length && a.join(' ') === b.join(' ')) {
					if (a.length > maxLen) {
						maxFrom = i;
						maxLen = j;
					}
				}
			}
		}
		
		if (maxLen) {
			let foundPart = nqp.slice(maxFrom, maxLen);
			
			let rems = nqp.slice(0, maxFrom);
			rems = rems.concat(nqp.slice(maxLen));
			
			if (rems.length) {
				let foundAuthor = false;
				let hasNumber = false;
				let yearFound = false;
				
				let rems2 = [];
				
				for (let rem of rems) {
					
					if (hasAuthor(item.authors, rem)) {
						foundAuthor = true;
					}
					else if (parseInt(rem) == rem && rem.length == 4) {
						hasNumber = true;
						if (item.years.indexOf(rem)>=0) {
							yearFound = true;
						}
						else {
							rems2.push(rem);
						}
					}
					else {
						rems2.push(rem);
					}
				}
				
				if (hasNumber && !yearFound) continue;
				if (rems2.length) continue;
			}
			
			results.push(formatItem(item) + ' (WorldCat)');
		}
	}
	return results;
}

async function main() {
	if (process.argv.length < 3) return;
	let query = process.argv[2];
	query = query.replace(/[:]/g, ' ');
	
	let results = await Promise.all([searchCrossref(query), searchWorldcat(query)]);
	results = results[0].concat(results[1]);
	
	console.log(JSON.stringify(results, 0, 2));
}

main();