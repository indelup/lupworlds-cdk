exports.handler = async (_event: any) => {
    return {
        statusCode: 200,
        body: JSON.stringify("Hello from Lambda!"),
    };
};
