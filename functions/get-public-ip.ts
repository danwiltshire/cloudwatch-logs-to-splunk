import fetch from 'cross-fetch';

interface IPIfyResponse {
    readonly ip: string
}

const checkIfValidIP = (ip: string): string => {
    // Regular expression to check if string is a IP address
    const regexExp = /^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/gi;
    if(regexExp.test(ip)) {
        return ip
    } else {
        throw new Error(`${ip} does not look valid.`);
    };
};

export const getPublicIp = async () => {
    const response = await fetch('https://api.ipify.org?format=json');
    const ip = await response.json()
        .then(data => data as IPIfyResponse)
        .then(data => checkIfValidIP(data.ip))
        .catch(err => {throw new Error("Couldn't get your public IP: " + err)});
    return ip
};
