import md5 from "crypto-js/md5";
function sortNestedArray(array) {
  array.sort();
  array.forEach((value, index) => {
    if (Array.isArray(value)) {
      array[index] = sortNestedArray(value);
    } else if (typeof value === 'object' && value !== null) {
      array[index] = sortNestedObject(value);
    }else {
      array[index] = value;
    }
  });
  return array;
}
function sortNestedObject(obj) {
  const sortedObj = {};
  Object.keys(obj).sort().forEach(key => {
    const value = obj[key];
    if (Array.isArray(value)) {
      sortedObj[key] = sortNestedArray([...value]);
    } else if (typeof value === 'object' && value !== null) {
      sortedObj[key] = sortNestedObject(value);
    } else {
      sortedObj[key] = value;
    }
  });
  return sortedObj;
}

// Basic implementation of the md5 hash function using the crypto module
function md555(input) {
  return md5(input).toString()
}

export function HashCreate(request, tokenKey) {
  let hashkey = '';
  const sortedRequest = Object.keys(request).sort().reduce((obj, key) => {
    obj[key] = request[key];
    return obj;
  }, {});
  for (const [key, value] of Object.entries(sortedRequest)) {
    if (Array.isArray(value)) {
      const sortedValue = sortNestedArray([...value]);
      sortedValue.forEach((val, index) => {
        hashkey += `&${index}=${md555(JSON.stringify(val))}`;
      });
      continue;
    } else if (typeof value === 'object' && value !== null){
      const sortedValue = sortNestedObject(value)
      for (const [keyObj, valueObj] of Object.entries(sortedValue)) {
        hashkey += `&${keyObj}=${md555(JSON.stringify(valueObj))}`;
      }
      continue
    }
    hashkey += `&${key}=${value}`;
  }

  hashkey = hashkey.substring(1);
  return md555(hashkey + tokenKey);
}